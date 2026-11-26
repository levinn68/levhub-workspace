'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Health = { checkedAt?: string; dependencies?: Record<string, { ok: boolean; message?: string; latencyMs?: number } | null> };
const names: Record<string, string> = { router: 'Router API', supabase: 'Supabase', runtime: 'MCP Runtime' };

export default function ConnectionsPage() {
  const [health, setHealth] = useState<Health>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function check() {
    setBusy(true); setError('');
    try { setHealth(await apiFetch<Health>('/api/health')); }
    catch (err) { setHealth(undefined); setError(err instanceof Error ? err.message : 'Koneksi belum bisa diperiksa.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void check(); }, []);
  const rows = Object.entries(health?.dependencies ?? {}).filter(([, result]) => result != null);
  return <AppShell title="Status koneksi"><section className="space-y-5">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">Status koneksi</h1><p className="mt-1 text-sm text-[var(--muted)]">Layanan yang diperiksa oleh backend LEVHUB.</p></div><button type="button" disabled={busy} onClick={() => void check()} className="rounded-lg border border-[var(--line)] px-4 py-2">Uji ulang</button></header>
    {busy && <p role="status">Memeriksa layanan…</p>}{error && <p role="alert">{error}</p>}
    {!busy && health && !rows.length && <p>Backend belum melaporkan status layanan.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{rows.map(([key, result]) => result && <article key={key} className="glass-card space-y-2 rounded-xl p-4"><h2 className="font-semibold">{names[key] ?? key}</h2><p className={result.ok ? 'text-emerald-300' : 'text-amber-300'}>{result.ok ? 'Terhubung' : 'Bermasalah'}</p><p className="text-sm text-[var(--muted)]">{result.message}{typeof result.latencyMs === 'number' && ` · ${result.latencyMs} ms`}</p></article>)}</div>
    {health?.checkedAt && <p className="text-sm text-[var(--muted)]">Dicek {new Date(health.checkedAt).toLocaleString('id-ID')}</p>}
  </section></AppShell>;
}
