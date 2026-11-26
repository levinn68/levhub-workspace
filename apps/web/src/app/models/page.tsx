'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Model = { id: string; displayName: string; provider?: string; available: boolean; capabilities?: { streaming?: boolean; tools?: boolean; vision?: boolean; contextLength?: number }; rawMetadata?: Record<string, unknown> };
type Catalog = { items: Model[]; fetchedAt: string; stale: boolean };

export default function ModelsPage() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  async function load(refresh = false) {
    setBusy(true); setError('');
    try { setCatalog(await apiFetch<Catalog>(refresh ? '/api/models/refresh' : '/api/models', { method: refresh ? 'POST' : 'GET' })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Katalog gagal dimuat.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const models = (catalog?.items ?? []).filter((model) => (!availableOnly || model.available) && `${model.displayName} ${model.id} ${model.provider ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <AppShell title="Model"><section className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Katalog model</h1><p className="mt-1 text-sm text-[var(--muted)]">Model dari Router API.</p></div><button type="button" disabled={busy} onClick={() => void load(true)} className="rounded-lg border border-[var(--line)] px-4 py-2">Segarkan</button></header>
    <div className="flex flex-wrap items-center gap-3"><input aria-label="Cari model atau provider" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari model atau provider" className="glass-input min-w-0 flex-1 rounded-lg px-3 py-2" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} /> Hanya yang tersedia</label></div>
    {busy && <p role="status">Memuat katalog…</p>}{error && <p role="alert">{error}</p>}
    {catalog && <p className="text-sm text-[var(--muted)]">{models.length} model · {catalog.stale ? 'Data cache · ' : ''}{new Date(catalog.fetchedAt).toLocaleString('id-ID')}</p>}
    {!busy && !error && !models.length && <p>Tidak ada model yang cocok.</p>}
    <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">{models.map((model) => <li key={model.id} className="space-y-2 p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="break-all font-semibold">{model.displayName}</h2><span className="text-sm text-[var(--muted)]">{model.available ? 'Tersedia' : 'Nonaktif'}</span></div><p className="break-all font-mono text-xs text-[var(--muted)]">{model.provider ? `${model.provider} · ` : ''}{model.id}</p>{model.capabilities && <p className="text-sm">{[model.capabilities.streaming && 'Streaming', model.capabilities.tools && 'Tools', model.capabilities.vision && 'Vision', model.capabilities.contextLength && `${model.capabilities.contextLength.toLocaleString('id-ID')} konteks`].filter(Boolean).join(' · ')}</p>}{model.rawMetadata && <details><summary className="cursor-pointer text-sm">Metadata</summary><pre className="mt-2 max-h-48 overflow-auto text-xs">{JSON.stringify(model.rawMetadata, null, 2)}</pre></details>}</li>)}</ul>
  </section></AppShell>;
}
