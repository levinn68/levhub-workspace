import { inflateRawSync } from 'node:zlib';
import type { AppConfig } from '../config.js';
import type { LevhubRepository } from '../db/supabase.js';
import type { LevhubErrorCode } from '../types.js';

/**
 * Server-side attachment content extraction.
 *
 * Why this exists: sending a signed storage URL to a model is NOT the same as
 * giving the model the file content. Non-vision models cannot open URLs, and
 * even vision models cannot parse PDF/DOCX/XLSX. This module downloads the
 * private object, extracts readable text under strict size limits, and returns
 * an honest per-file result so the orchestrator can either include real content
 * or report a precise limitation instead of pretending.
 *
 * Security posture:
 * - content is treated as untrusted DATA, never as instructions
 * - no shell, no eval, no external binary invocation
 * - bounded download and bounded per-file output
 */

export interface AttachmentDescriptor {
  path: string;
  name: string;
  mimeType: string;
  size: number;
}

export type ExtractionStatus = 'extracted' | 'unsupported' | 'failed' | 'too_large';

export interface ExtractionResult {
  name: string;
  mimeType: string;
  status: ExtractionStatus;
  /** Extracted plain text (possibly truncated). Empty when not extractable. */
  text: string;
  /** Human-readable (Indonesian) explanation used in the UI/model prompt. */
  reason: string;
  truncated: boolean;
}

/** MIME types handled by vision (image_url) instead of text extraction. */
export function isVisionMimeType(mimeType: string): boolean {
  return /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(mimeType);
}

const MAX_PER_FILE_CHARS = 120_000;
const MAX_TOTAL_CHARS = 240_000;

function truncate(text: string, limit = MAX_PER_FILE_CHARS): { text: string; truncated: boolean } {
  const normalized = text.replace(/\u0000/g, '').replace(/\r\n/g, '\n');
  if (normalized.length <= limit) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, limit), truncated: true };
}

/** Decodes bytes as UTF-8 text with a hard length guard. */
function decodeText(buffer: Buffer): string {
  return buffer.toString('utf8');
}

/**
 * Minimal PDF text extraction: reads uncompressed text operators from content
 * streams and inflates FlateDecode streams. Deliberately small and defensive;
 * it is not a full PDF parser and returns an honest empty result when text is
 * encoded in a way it cannot read (e.g. CMap glyphs, scanned images).
 */
function extractPdfText(buffer: Buffer): { text: string; note: string } {
  const chunks: string[] = [];
  const raw = buffer.toString('latin1');

  // Inline (uncompressed) text: (Hello) Tj  and  [(A) -2 (B)] TJ
  const inlineRegex = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ)/g;
  let inline: RegExpExecArray | null;
  while ((inline = inlineRegex.exec(raw)) !== null) {
    chunks.push(unescapePdfString(inline[1]));
  }

  // FlateDecode streams: inflate then scan for the same text operators.
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let stream: RegExpExecArray | null;
  let inflatedAny = false;
  while ((stream = streamRegex.exec(raw)) !== null) {
    const bytes = Buffer.from(stream[1], 'latin1');
    try {
      const inflated = inflateRawSync(bytes, { maxOutputLength: 8 * 1024 * 1024 }).toString('latin1');
      inflatedAny = true;
      const inner = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ)/g;
      let m: RegExpExecArray | null;
      while ((m = inner.exec(inflated)) !== null) chunks.push(unescapePdfString(m[1]));
    } catch {
      // Not a raw-deflate stream or exceeds limit: skip silently.
    }
  }

  const text = chunks.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) {
    return {
      text: '',
      note: inflatedAny
        ? 'Teks PDF tidak dapat diekstrak dengan aman (kemungkinan hasil scan atau font terenkode).'
        : 'PDF tidak mengandung teks yang dapat diekstrak (kemungkinan hasil scan).',
    };
  }
  return { text, note: '' };
}

function unescapePdfString(input: string): string {
  return input.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, group: string) => {
    if (/^[0-7]+$/.test(group)) return String.fromCharCode(parseInt(group, 8));
    switch (group) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      default: return group;
    }
  });
}

/** Reads a single entry from a ZIP buffer (DOCX/XLSX are ZIP containers). */
function readZipEntry(buffer: Buffer, wantedSuffixes: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (i >= 0 && buffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) return out;

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.subarray(nameStart, nameStart + fileNameLen).toString('utf8');
    cursor = nameStart + fileNameLen + extraLen + commentLen;

    if (!wantedSuffixes.some((suffix) => name.endsWith(suffix))) continue;
    if (compressedSize > 16 * 1024 * 1024) continue; // guard per entry
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) continue;
    const rawData = buffer.subarray(dataStart, dataEnd);

    try {
      const content = method === 0
        ? rawData
        : inflateRawSync(rawData, { maxOutputLength: 16 * 1024 * 1024 });
      out.set(name, content);
    } catch {
      // Skip undecodable entry.
    }
  }
  return out;
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDocxText(buffer: Buffer): { text: string; note: string } {
  const entries = readZipEntry(buffer, ['word/document.xml']);
  const doc = entries.get('word/document.xml');
  if (!doc) return { text: '', note: 'Struktur DOCX tidak dikenali (word/document.xml tidak ditemukan).' };
  return { text: stripXmlTags(doc.toString('utf8')), note: '' };
}

function extractXlsxText(buffer: Buffer): { text: string; note: string } {
  const entries = readZipEntry(buffer, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  const lines: string[] = [];

  const shared = entries.get('xl/sharedStrings.xml');
  const sharedStrings: string[] = [];
  if (shared) {
    const siRegex = /<si>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = siRegex.exec(shared.toString('utf8'))) !== null) {
      sharedStrings.push(stripXmlTags(m[1]));
    }
  }

  const sheet = entries.get('xl/worksheets/sheet1.xml');
  if (sheet) {
    const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(sheet.toString('utf8'))) !== null) {
      const cells: string[] = [];
      const cellRegex = /<c[^>]*?(?:t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const type = cellMatch[1];
        const inner = cellMatch[2];
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const value = vMatch ? vMatch[1] : '';
        if (type === 's') {
          const idx = Number(value);
          cells.push(Number.isFinite(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : value);
        } else if (type === 'inlineStr') {
          cells.push(stripXmlTags(inner));
        } else {
          cells.push(value);
        }
      }
      if (cells.some((c) => c !== '')) lines.push(cells.join(' | '));
      if (lines.length >= 2000) break; // bound output
    }
  }

  if (lines.length === 0) return { text: '', note: 'Sheet pertama kosong atau format sel tidak dapat dibaca.' };
  return { text: lines.join('\n'), note: '' };
}

/** CSV is rendered as a simple aligned table preview. */
function csvToPreview(text: string): string {
  return text
    .split(/\r?\n/)
    .slice(0, 2000)
    .join('\n');
}

export class AttachmentExtractor {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: LevhubRepository,
  ) {}

  /** Downloads and extracts all attachments, enforcing total output budget. */
  async extractAll(attachments: AttachmentDescriptor[]): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];
    let totalChars = 0;

    for (const attachment of attachments.slice(0, 8)) {
      if (!attachment.path.startsWith(`${this.config.WORKSPACE_ID}/`)) {
        results.push(this.failure(attachment, 'failed', 'Lampiran berada di luar workspace dan diabaikan.'));
        continue;
      }
      if (isVisionMimeType(attachment.mimeType)) {
        results.push({
          name: attachment.name,
          mimeType: attachment.mimeType,
          status: 'extracted',
          text: '',
          reason: 'Gambar diteruskan ke model vision.',
          truncated: false,
        });
        continue;
      }
      if (totalChars >= MAX_TOTAL_CHARS) {
        results.push(this.failure(attachment, 'too_large', 'Batas total teks lampiran tercapai; file ini tidak diproses.'));
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = await this.repo.downloadChatAttachment(attachment.path);
      } catch {
        results.push(this.failure(attachment, 'failed', 'Gagal mengunduh lampiran dari storage.'));
        continue;
      }

      if (buffer.length > this.config.MAX_CHAT_ATTACHMENT_BYTES) {
        results.push(this.failure(attachment, 'too_large', 'Ukuran file melebihi batas pemrosesan.'));
        continue;
      }

      const result = this.extractOne(attachment, buffer);
      const room = Math.max(0, MAX_TOTAL_CHARS - totalChars);
      const { text, truncated } = truncate(result.text, Math.min(MAX_PER_FILE_CHARS, room));
      totalChars += text.length;
      results.push({ ...result, text, truncated: truncated || result.truncated });
    }

    return results;
  }

  private extractOne(attachment: AttachmentDescriptor, buffer: Buffer): ExtractionResult {
    const mime = attachment.mimeType.toLowerCase();
    const lowerName = attachment.name.toLowerCase();

    const textLike = /^text\//.test(mime) || mime === 'application/json' || /\.(txt|md|csv|json|log)$/.test(lowerName);
    if (textLike) {
      const raw = decodeText(buffer);
      const body = /\.csv$/i.test(lowerName) || mime === 'text/csv' ? csvToPreview(raw) : raw;
      return { name: attachment.name, mimeType: attachment.mimeType, status: 'extracted', text: body, reason: '', truncated: false };
    }

    if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
      const { text, note } = extractPdfText(buffer);
      if (!text) return this.failure(attachment, 'unsupported', note);
      return { name: attachment.name, mimeType: attachment.mimeType, status: 'extracted', text, reason: note, truncated: false };
    }

    if (/wordprocessingml/.test(mime) || lowerName.endsWith('.docx')) {
      const { text, note } = extractDocxText(buffer);
      if (!text) return this.failure(attachment, 'unsupported', note);
      return { name: attachment.name, mimeType: attachment.mimeType, status: 'extracted', text, reason: note, truncated: false };
    }

    if (/spreadsheetml/.test(mime) || lowerName.endsWith('.xlsx')) {
      const { text, note } = extractXlsxText(buffer);
      if (!text) return this.failure(attachment, 'unsupported', note);
      return { name: attachment.name, mimeType: attachment.mimeType, status: 'extracted', text, reason: note, truncated: false };
    }

    if (lowerName.endsWith('.doc') || lowerName.endsWith('.xls')) {
      return this.failure(attachment, 'unsupported', 'Format .doc/.xls lama belum didukung. Simpan ulang sebagai .docx/.xlsx.');
    }

    if (mime.startsWith('video/')) {
      return this.failure(attachment, 'unsupported', 'Ekstraksi frame/transkripsi video belum tersedia pada runtime ini.');
    }

    if (mime === 'application/zip' || lowerName.endsWith('.zip')) {
      return this.failure(attachment, 'unsupported', 'Arsip ZIP tidak diekstrak otomatis. Unggah isi file secara terpisah.');
    }

    return this.failure(attachment, 'unsupported', 'Format file ini belum dapat dibaca oleh pipeline ekstraksi.');
  }

  private failure(attachment: AttachmentDescriptor, status: ExtractionStatus, reason: string): ExtractionResult {
    return { name: attachment.name, mimeType: attachment.mimeType, status, text: '', reason, truncated: false };
  }
}

export type { LevhubErrorCode };
