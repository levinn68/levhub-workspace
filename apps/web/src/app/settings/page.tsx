'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shield, Activity, LogOut, ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

interface SettingsPayload {
  workspaceName: string;
  connections: {
    router: { endpoint: string; hasApiKey: boolean };
    runtime: { endpoint: string | null; hasToken: boolean };
    supabase: { configured: boolean; bucket: string };
  };
  limits: {
    maxToolCallsPerTurn: number;
    toolExecutionTimeoutMs: number;
    maxSkillArchiveBytes: number;
    sessionTtlHours: number;
  };
}

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [audit, setAudit] = useState<Array<{ id: string; event_type: string; created_at: string }>>([]);

  useEffect(() => {
    apiFetch<SettingsPayload>('/api/settings').then(setData).catch(() => {});
    apiFetch<{ items: Array<{ id: string; event_type: string; created_at: string }> }>('/api/audit/events')
      .then((res) => setAudit(res.items))
      .catch(() => {});
  }, []);

  async function handleLogoutAll() {
    if (!confirm('Cabut semua sesi aktif LEVHUB? Anda akan perlu login ulang.')) return;
    await apiFetch('/api/auth/logout-all', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <AppShell title="Pengaturan LEVHUB">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="glass-panel rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Activity className="h-4 w-4 text-sky-400" /> Status Koneksi & Secret
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Nilai secret bersifat write-only dan tidak pernah dikirim ke browser.
            </p>
            {data && (
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Router API</dt>
                  <dd className="font-mono text-slate-200">
                    {data.connections.router.hasApiKey ? 'Key Terpasang' : 'Tanpa Key'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Runtime Upstream</dt>
                  <dd className="text-slate-200">{data.connections.runtime.endpoint ? 'Terkonfigurasi' : 'Opsional'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Supabase Storage Bucket</dt>
                  <dd className="font-mono text-slate-200">{data.connections.supabase.bucket}</dd>
                </div>
              </dl>
            )}
            <Link
              href="/settings/connections"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 hover:underline"
            >
              Buka Monitor Kesehatan Koneksi <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield className="h-4 w-4 text-indigo-400" /> Keamanan & Batas Eksekusi
            </h2>
            {data && (
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Masa Aktif Sesi</dt>
                  <dd className="text-slate-200">{data.limits.sessionTtlHours} jam</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Maks. Tool Call / Turn</dt>
                  <dd className="text-slate-200">{data.limits.maxToolCallsPerTurn}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Timeout Eksekusi Tool</dt>
                  <dd className="text-slate-200">{data.limits.toolExecutionTimeoutMs / 1000} detik</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Maks. Arsip Skill ZIP</dt>
                  <dd className="text-slate-200">
                    {Math.round(data.limits.maxSkillArchiveBytes / (1024 * 1024))} MB
                  </dd>
                </div>
              </dl>
            )}
            <button
              type="button"
              onClick={handleLogoutAll}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3.5 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
            >
              <LogOut className="h-3.5 w-3.5" /> Keluar dari Semua Sesi
            </button>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white">Log Aktivitas Terbaru (Teredaksi)</h2>
          <div className="mt-3 space-y-1.5">
            {audit.length === 0 ? (
              <p className="text-xs text-slate-400">Belum ada catatan aktivitas.</p>
            ) : (
              audit.slice(0, 12).map((ev) => (
                <div key={ev.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-xs">
                  <span className="font-mono text-sky-200">{ev.event_type}</span>
                  <span className="text-slate-400">{new Date(ev.created_at).toLocaleString('id-ID')}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
