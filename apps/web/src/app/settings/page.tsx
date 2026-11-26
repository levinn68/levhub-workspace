'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Settings = {
  workspaceName: string;
  connections: { router: { hasApiKey: boolean }; supabase: { configured: boolean; bucket: string } };
  limits: { sessionTtlHours: number; maxToolCallsPerTurn: number; toolExecutionTimeoutMs: number; maxSkillArchiveBytes: number };
};
type Audit = { id: string; event_type: string; created_at: string };
const action = 'inline-flex min-h-11 items-center rounded-lg border border-[var(--line)] px-3 text-sm disabled:opacity-50';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>();
  const [audit, setAudit] = useState<Audit[]>();
  const [settingsError, setSettingsError] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void apiFetch<Settings>('/api/settings', { signal }).then((value) => { if (!signal.aborted) setSettings(value); }).catch(() => { if (!signal.aborted) setSettingsError(true); });
    void apiFetch<{ items: Audit[] }>('/api/audit/events', { signal }).then(({ items }) => { if (!signal.aborted) setAudit(items); }).catch(() => { if (!signal.aborted) setAuditError(true); });
    return () => controller.abort();
  }, [attempt]);

  async function logoutAll() {
    setBusy(true); setLogoutError(false);
    try { await apiFetch('/api/auth/logout-all', { method: 'POST' }); router.replace('/login'); }
    catch { setLogoutError(true); setBusy(false); }
  }

  return <AppShell title="Pengaturan"><div className="mx-auto max-w-3xl space-y-5">
    <header><h1 className="text-2xl font-semibold">Pengaturan</h1><p className="mt-1 text-sm text-[var(--muted)]">{settings?.workspaceName ?? 'Workspace pribadi'}</p></header>
    {(settingsError || auditError) && <button type="button" className={action} onClick={() => { setSettingsError(false); setAuditError(false); setAttempt((n) => n + 1); }}>Muat ulang data</button>}
    <section className="glass-card space-y-3 rounded-xl p-4"><h2 className="font-semibold">Koneksi</h2>
      {settingsError ? <p role="alert">Konfigurasi koneksi gagal dimuat.</p> : settings ? <dl className="grid gap-2 text-sm"><div><dt>Router API</dt><dd className="text-[var(--muted)]">{settings.connections.router.hasApiKey ? 'API key terpasang' : 'API key belum terpasang'}</dd></div><div><dt>Supabase</dt><dd className="break-words text-[var(--muted)]">{settings.connections.supabase.configured ? `Terkonfigurasi · ${settings.connections.supabase.bucket}` : 'Belum dikonfigurasi'}</dd></div></dl> : <p role="status">Memuat konfigurasi…</p>}
      <Link href="/settings/connections" className={action}>Lihat status koneksi</Link>
    </section>
    <section className="glass-card space-y-3 rounded-xl p-4"><h2 className="font-semibold">Sesi dan batas penggunaan</h2>
      {settings && <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt>Masa aktif sesi</dt><dd>{settings.limits.sessionTtlHours} jam</dd></div><div><dt>Maksimum tool per giliran</dt><dd>{settings.limits.maxToolCallsPerTurn}</dd></div><div><dt>Batas waktu tool</dt><dd>{settings.limits.toolExecutionTimeoutMs / 1000} detik</dd></div><div><dt>Batas arsip skill</dt><dd>{(settings.limits.maxSkillArchiveBytes / 1048576).toLocaleString('id-ID')} MiB</dd></div></dl>}
      {confirming ? <div className="space-y-2"><p className="text-sm">Semua sesi aktif akan dicabut, termasuk sesi ini.</p><div className="flex flex-wrap gap-2"><button type="button" className={`${action} text-rose-300`} disabled={busy} onClick={() => void logoutAll()}>{busy ? 'Mencabut sesi…' : 'Ya, cabut semua sesi'}</button><button type="button" className={action} disabled={busy} onClick={() => { setConfirming(false); setLogoutError(false); }}>Batal</button></div></div> : <button type="button" className={action} onClick={() => setConfirming(true)}>Keluar dari semua sesi</button>}
      {logoutError && <p role="alert" className="text-rose-300">Sesi gagal dicabut. Coba lagi.</p>}
    </section>
    <section className="glass-card space-y-3 rounded-xl p-4"><h2 className="font-semibold">Aktivitas terbaru</h2>
      {auditError ? <p role="alert">Log aktivitas gagal dimuat.</p> : !audit ? <p role="status">Memuat aktivitas…</p> : !audit.length ? <p>Belum ada aktivitas.</p> : <ul className="divide-y divide-[var(--line)]">{audit.slice(0, 12).map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm"><span className="break-all">{event.event_type}</span><time className="text-[var(--muted)]" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString('id-ID')}</time></li>)}</ul>}
    </section>
  </div></AppShell>;
}
