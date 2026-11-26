'use client';

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Paperclip, Send, Square, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export type Attachment = { path: string; name: string; mimeType: string; size: number };
type SignedUpload = { signedUrl: string; token?: string; path: string };
const MAX_FILES = 8;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.zip';
const bytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

async function upload(file: File): Promise<Attachment> {
  const mimeType = file.type || 'application/octet-stream';
  const signed = await apiFetch<SignedUpload>('/api/chat/attachments/sign', { method: 'POST', body: JSON.stringify({ name: file.name, mimeType, size: file.size }) });
  const headers: Record<string, string> = { 'Content-Type': mimeType, 'x-upsert': 'false' };
  if (signed.token) headers.Authorization = `Bearer ${signed.token}`;
  const response = await fetch(signed.signedUrl, { method: 'PUT', headers, body: file });
  if (!response.ok) throw new Error(`${file.name} gagal diunggah (HTTP ${response.status}).`);
  return { path: signed.path, name: file.name, mimeType, size: file.size };
}

export function ChatComposer({ value, onChange, onSubmit, disabled, streaming, onStop, attachments, onAttachmentsChange, modelHint }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  streaming: boolean;
  onStop: () => void;
  attachments: Attachment[];
  onAttachmentsChange: (next: Attachment[]) => void;
  modelHint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const canSend = !disabled && !uploading && (value.trim().length > 0 || attachments.length > 0);

  async function select(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    const room = MAX_FILES - attachments.length;
    if (!files.length) return;
    if (room <= 0) { setUploadError(`Maksimal ${MAX_FILES} lampiran.`); return; }
    setUploading(true); setUploadError('');
    const results = await Promise.allSettled(files.slice(0, room).map(upload));
    const done = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []);
    const failures = results.flatMap((r) => r.status === 'rejected' ? [r.reason instanceof Error ? r.reason.message : 'File gagal diunggah.'] : []);
    onAttachmentsChange([...attachments, ...done].slice(0, MAX_FILES));
    if (failures.length) setUploadError(failures.join(' '));
    else if (files.length > room) setUploadError(`${files.length - room} file dilewati karena batas ${MAX_FILES}.`);
    setUploading(false);
  }

  function send(event: FormEvent) { event.preventDefault(); if (canSend) onSubmit(); }

  return <div className="chat-composer">
    <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(event) => void select(event)} />
    {attachments.length > 0 && <ul className="chat-attachments" aria-label="Lampiran siap dikirim">{attachments.map((file) => <li key={file.path}><span>{file.name}</span><small>{bytes(file.size)}</small><button type="button" aria-label={`Hapus ${file.name}`} onClick={() => onAttachmentsChange(attachments.filter((item) => item.path !== file.path))}><X size={14} /></button></li>)}</ul>}
    {(uploadError || uploading) && <p className="chat-hint" role="status">{uploading ? 'Mengunggah lampiran…' : uploadError}</p>}
    <form onSubmit={send} className="chat-input-row">
      <button type="button" className="chat-icon-button" aria-label="Lampirkan file" disabled={disabled || streaming || uploading || attachments.length >= MAX_FILES} onClick={() => input.current?.click()}><Paperclip size={18} /></button>
      <label className="sr-only" htmlFor="chat-draft">Pesan</label>
      <textarea id="chat-draft" rows={1} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSend) onSubmit(); } }} placeholder="Tulis pesan…" />
      {streaming ? <button type="button" className="chat-send chat-stop" onClick={onStop}><Square size={15} /> Stop</button> : <button type="submit" className="chat-send" disabled={!canSend}><Send size={15} /> Kirim</button>}
    </form>
    <p className="chat-hint">{attachments.length}/{MAX_FILES} lampiran{modelHint ? ` · ${modelHint}` : ''} · Enter kirim, Shift+Enter baris baru</p>
  </div>;
}
