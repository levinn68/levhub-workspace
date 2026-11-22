'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, Search, Cpu, Code2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

interface ModelEntry {
  id: string;
  displayName: string;
  provider?: string;
  available: boolean;
  capabilities?: { streaming?: boolean; tools?: boolean; vision?: boolean; contextLength?: number };
  rawMetadata?: Record<string, unknown>;
}

export default function ModelsPage() {
  const [items, setItems] = useState<ModelEntry[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadModels(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ items: ModelEntry[]; fetchedAt: string; stale: boolean }>(
        force ? '/api/models/refresh' : '/api/models',
        { method: force ? 'POST' : 'GET' },
      );
      setItems(res.items);
      setFetchedAt(res.fetchedAt);
      setStale(res.stale);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat katalog model.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadModels(false);
  }, []);

  const filtered = items.filter((m) =>
    `${m.id} ${m.displayName} ${m.provider || ''}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <AppShell
      title="Katalog Model Router"
      topBarExtra={
        <button
          type="button"
          onClick={() => loadModels(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari model atau provider..."
              className="glass-input w-full rounded-xl py-2 pl-9 pr-3 text-sm text-white"
            />
          </div>
          {fetchedAt && (
            <p className="text-xs text-slate-400">
              Terakhir diperbarui: {new Date(fetchedAt).toLocaleString('id-ID')} {stale ? '(cache lama)' : ''}
            </p>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-200">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="glass-panel rounded-2xl p-8 text-center text-sm text-slate-400">
            Tidak ada model yang cocok dari Router API.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((m) => (
            <div key={m.id} className="glass-card rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-4 w-4 shrink-0 text-sky-400" />
                    <h2 className="truncate text-sm font-semibold text-white">{m.displayName}</h2>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{m.id}</p>
                </div>
                {m.provider && (
                  <span className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">{m.provider}</span>
                )}
              </div>

              {m.capabilities && (
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  {m.capabilities.streaming && (
                    <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-sky-200">Streaming</span>
                  )}
                  {m.capabilities.tools && (
                    <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-indigo-200">Tool Calling</span>
                  )}
                  {m.capabilities.vision && (
                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-200">Vision</span>
                  )}
                  {m.capabilities.contextLength && (
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-slate-300">
                      {m.capabilities.contextLength.toLocaleString('id-ID')} ctx
                    </span>
                  )}
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  {expandedId === m.id ? 'Sembunyikan Metadata' : 'Metadata Upstream'}
                </button>
              </div>

              {expandedId === m.id && m.rawMetadata && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-xl bg-black/50 p-2.5 font-mono text-[11px] text-slate-300">
                  {JSON.stringify(m.rawMetadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
