'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

interface DependencyStatus {
  ok: boolean;
  latencyMs: number;
  message: string;
  endpoint?: string;
}

interface HealthResponse {
  status: string;
  checkedAt: string;
  dependencies: {
    router: DependencyStatus;
    runtime: DependencyStatus;
    supabase: DependencyStatus;
  };
}

export default function ConnectionsPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await apiFetch<HealthResponse>('/api/health');
      setHealth(res);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const cards = health
    ? [
        { name: 'Router API', data: health.dependencies.router },
        { name: 'Supabase PostgreSQL', data: health.dependencies.supabase },
        { name: 'Runtime Upstream (MCP/Skills)', data: health.dependencies.runtime },
      ]
    : [];

  return (
    <AppShell
      title="Status Koneksi & Kesehatan"
      topBarExtra={
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Uji Ulang
        </button>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <div key={c.name} className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">{c.name}</h2>
              {c.data.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-rose-400" />
              )}
            </div>
            <p className="mt-2 text-xs text-slate-300">{c.data.message}</p>
            {c.data.endpoint && <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{c.data.endpoint}</p>}
            <p className="mt-3 text-[11px] text-slate-400">Latensi: {c.data.latencyMs} ms</p>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
