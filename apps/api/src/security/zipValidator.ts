import { LevhubError } from './errors.js';

export interface ValidatedSkillManifest {
  slug: string;
  name: string;
  version: string | null;
  description: string;
  requiredTools: string[];
  instructionsMarkdown: string;
  files: Array<{ path: string; sizeBytes: number }>;
  warnings: string[];
}

const DISALLOWED_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bat',
  '.cmd',
  '.ps1',
  '.msi',
  '.bin',
  '.elf',
  '.apk',
]);

const ALLOWED_TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.js',
  '.mjs',
  '.ts',
  '.py',
  '.sh',
  '.css',
  '.html',
  '.svg',
]);

export function validateSafeArchiveEntryPath(entryPath: string): void {
  if (!entryPath || entryPath.includes('\0')) {
    throw new LevhubError('SKILL_INVALID', 'Nama file tidak valid dalam arsip Skill.', 400);
  }
  if (entryPath.startsWith('/') || entryPath.startsWith('\\') || /^[a-zA-Z]:/.test(entryPath)) {
    throw new LevhubError('SKILL_INVALID', `Path absolut ditolak dalam arsip Skill: ${entryPath}`, 400);
  }
  const segments = entryPath.split(/[/\\]+/);
  if (segments.some((s) => s === '..')) {
    throw new LevhubError('SKILL_INVALID', `Path traversal (..) ditolak: ${entryPath}`, 400);
  }

  const lower = entryPath.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lower.slice(dotIdx);
    if (DISALLOWED_EXTENSIONS.has(ext)) {
      throw new LevhubError('SKILL_INVALID', `Tipe file eksekutable/biner ditolak: ${ext}`, 400);
    }
  }
}

/**
 * Inspects ZIP Central Directory headers safely without blind extraction.
 * Protects against path traversal, symlinks, oversized archives, and decompression bombs (FR-SKL-003 / S-008).
 */
export function inspectZipArchiveBuffer(
  buffer: Buffer,
  options: { maxArchiveBytes?: number; maxUncompressedBytes?: number; maxCompressionRatio?: number; maxEntries?: number } = {},
): Array<{ path: string; compressedSize: number; uncompressedSize: number }> {
  const maxArchiveBytes = options.maxArchiveBytes ?? 10 * 1024 * 1024;
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 50 * 1024 * 1024;
  const maxCompressionRatio = options.maxCompressionRatio ?? 50;
  const maxEntries = options.maxEntries ?? 200;

  if (buffer.length > maxArchiveBytes) {
    throw new LevhubError('SKILL_INVALID', 'Ukuran arsip ZIP melebihi batas maksimum.', 400);
  }

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new LevhubError('SKILL_INVALID', 'File ZIP rusak atau tidak valid (EOCD tidak ditemukan).', 400);
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries === 0 || totalEntries > maxEntries) {
    throw new LevhubError('SKILL_INVALID', `Jumlah file dalam ZIP tidak valid (${totalEntries}).`, 400);
  }

  const entries: Array<{ path: string; compressedSize: number; uncompressedSize: number }> = [];
  let cursor = cdOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new LevhubError('SKILL_INVALID', 'Header Central Directory ZIP rusak.', 400);
    }

    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);

    // Detect Unix symlink (0o120000 in upper 16 bits)
    const unixMode = (externalAttrs >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new LevhubError('SKILL_INVALID', 'Symlink di dalam arsip ZIP ditolak demi keamanan.', 400);
    }

    const nameStart = cursor + 46;
    const filePath = buffer.subarray(nameStart, nameStart + fileNameLen).toString('utf8');
    cursor = nameStart + fileNameLen + extraLen + commentLen;

    if (filePath.endsWith('/')) continue; // directory entry

    validateSafeArchiveEntryPath(filePath);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxUncompressedBytes) {
      throw new LevhubError('SKILL_INVALID', 'Total ukuran ekstraksi ZIP melebihi batas aman (potensi zip bomb).', 400);
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > maxCompressionRatio) {
      throw new LevhubError('SKILL_INVALID', 'Rasio kompresi ZIP mencurigakan (potensi decompression bomb).', 400);
    }

    entries.push({ path: filePath, compressedSize, uncompressedSize });
  }

  const hasSkillMd = entries.some((e) => e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md'));
  if (!hasSkillMd) {
    throw new LevhubError('SKILL_INVALID', 'Arsip Skill wajib memiliki file SKILL.md.', 400);
  }

  return entries;
}

/**
 * Parses and validates SKILL.md YAML frontmatter and body.
 * Treats instructions strictly as untrusted data (FR-SKL-007).
 */
export function parseSkillMarkdown(rawMarkdown: string): ValidatedSkillManifest {
  const trimmed = rawMarkdown.trim();
  if (!trimmed) {
    throw new LevhubError('SKILL_INVALID', 'Konten SKILL.md kosong.', 400);
  }

  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new LevhubError('SKILL_INVALID', 'SKILL.md wajib diawali YAML frontmatter (--- ... ---).', 400);
  }

  const frontmatterRaw = fmMatch[1];
  const body = fmMatch[2].trim();
  const meta: Record<string, string> = {};

  for (const line of frontmatterRaw.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  }

  const name = meta.name?.trim();
  const description = meta.description?.trim();
  if (!name || !description) {
    throw new LevhubError('SKILL_INVALID', 'Frontmatter SKILL.md wajib berisi field `name` dan `description`.', 400);
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const requiredTools = meta.required_tools
    ? meta.required_tools
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const warnings: string[] = [];
  if (/ignore previous instructions|override system policy|bypass approval/i.test(body)) {
    warnings.push('Instruksi Skill mengandung pola yang mencoba mengubah kebijakan sistem; diisolasi sebagai data tidak tepercaya.');
  }

  return {
    slug,
    name,
    version: meta.version || '1.0.0',
    description,
    requiredTools,
    instructionsMarkdown: body,
    files: [{ path: 'SKILL.md', sizeBytes: Buffer.byteLength(rawMarkdown, 'utf8') }],
    warnings,
  };
}

export function isAllowedSkillFileExtension(filePath: string): boolean {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return ALLOWED_TEXT_EXTENSIONS.has(filePath.slice(dotIdx).toLowerCase());
}
