'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Conversation = { id: string; title: string; model_id: string | null; updated_at: string };
const button = 'rounded-lg border border-[var(--line)] px-3 py-2 text-sm';

export default function HistoryPage() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<{ id: string; title: string }>();
  const [removing, setRemoving] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<{ items: Conversation[] }>('/api/conversations', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setItems(data.items); })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Riwayat gagal dimuat.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Aksi gagal. Coba lagi.'); }
    finally { setBusy(false); }
  }
  async function search() {
    const value = query.trim();
    const data = await apiFetch<{ items: Conversation[] }>(`/api/conversations?search=${encodeURIComponent(value)}`);
    setItems(data.items); setApplied(value); setEdit(undefined); setRemoving(undefined);
  }

  return <AppShell title="Riwayat"><section className="mx-auto max-w-3xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Riwayat percakapan</h1><Link className={button} href="/chat">Chat baru</Link></header>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void run(search); }}><input className="glass-input min-w-0 flex-1 rounded-lg p-3" type="search" aria-label="Cari judul percakapan" placeholder="Cari judul percakapan" value={query} onChange={(event) => setQuery(event.target.value)} /><button className={button} disabled={busy}>Cari</button></form>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {busy && <p role="status" className="text-sm text-[var(--muted)]">Memproses…</p>}
    {!busy && !error && !items.length && <p className="text-[var(--muted)]">{applied ? 'Tidak ada percakapan yang cocok.' : 'Belum ada percakapan tersimpan.'}</p>}
    <ul className="space-y-3">{items.map((item) => {
      const path = `/api/conversations/${encodeURIComponent(item.id)}`;
      return <li key={item.id} className="glass-card space-y-3 rounded-xl p-4">
        <Link href={`/chat?id=${encodeURIComponent(item.id)}`} className="block break-words font-semibold hover:underline">{item.title}</Link>
        <p className="break-words text-xs text-[var(--muted)]">{item.model_id || 'Model tidak diketahui'} · {new Date(item.updated_at).toLocaleString('id-ID')}</p>
        <div className="flex flex-wrap gap-2"><a className={button} href={`${path}/export?format=markdown`}>Unduh MD</a><a className={button} href={`${path}/export?format=json`}>Unduh JSON</a><button type="button" className={button} disabled={busy} onClick={() => { setEdit({ id: item.id, title: item.title }); setRemoving(undefined); }}>Ubah judul</button><button type="button" className={button} disabled={busy} onClick={() => { setRemoving(item.id); setEdit(undefined); }}>Hapus</button></div>
        {edit?.id === item.id && <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const title = edit.title.trim(); if (!title) return; void run(async () => { await apiFetch(path, { method: 'PATCH', body: JSON.stringify({ title }) }); setItems((prev) => prev.flatMap((entry) => entry.id !== item.id ? [entry] : !applied || title.toLowerCase().includes(applied.toLowerCase()) ? [{ ...entry, title }] : [])); setEdit(undefined); }); }}><input aria-label="Judul baru" className="glass-input min-w-0 flex-1 rounded-lg p-2" required maxLength={160} value={edit.title} onChange={(event) => setEdit({ id: item.id, title: event.target.value })}/><button className={button} disabled={busy || !edit.title.trim()}>Simpan</button><button type="button" className={button} disabled={busy} onClick={() => setEdit(undefined)}>Batal</button></form>}
        {removing === item.id && <div className="flex flex-wrap items-center gap-2"><p className="text-sm">Hapus permanen percakapan ini?</p><button type="button" className={`${button} text-rose-300`} disabled={busy} onClick={() => void run(async () => { await apiFetch(path, { method: 'DELETE' }); setItems((prev) => prev.filter((entry) => entry.id !== item.id)); setRemoving(undefined); })}>Ya, hapus</button><button type="button" className={button} disabled={busy} onClick={() => setRemoving(undefined)}>Batal</button></div>}
      </li>;
    })}</ul>
  </section></AppShell>;
}
