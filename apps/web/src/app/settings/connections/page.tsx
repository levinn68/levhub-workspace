'use client';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Health = { dependencies?: Record<string, { ok: boolean; message: string; latencyMs?: number } | undefined> };
const names: Record<string, string> = { router: 'Router API', supabase: 'Supabase', runtime: 'MCP Runtime' };
export default function ConnectionsPage() {
  const [health, setHealth] = useState<Health>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  async function refresh() {
    setBusy(true); setError('');
    try { setHealth(await apiFetch<Health>('/api/health')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal memuat status koneksi.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <AppShell title="Status koneksi" topBarExtra={<button className="workspace-action" onClick={refresh} disabled={busy}>Uji ulang</button>}>
    {busy && <p role="status">Memeriksa koneksi…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2">{Object.entries(health?.dependencies ?? {}).map(([key, data]) => data ? <article className="glass-card rounded-xl p-5" key={key}><h2>{names[key] ?? key} · {data.ok ? 'Terhubung' : 'Bermasalah'}</h2><p className="mt-2 text-sm text-[var(--muted)]">{data.message}{typeof data.latencyMs === 'number' && ` · ${data.latencyMs} ms`}</p></article> : null)}</div>
  </AppShell>;
}
