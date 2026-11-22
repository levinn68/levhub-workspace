'use client';

import React, { useEffect, useState } from 'react';
import { Plug, Plus, Trash2, CheckCircle2, Power, RefreshCw } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

interface ExternalMcpItem {
  id: string;
  displayName: string;
  config: { transport?: string; endpoint?: string; authType?: string };
  hasSecret: boolean;
  status: string;
  enabled: boolean;
  lastHealthCheck: string | null;
}

interface RuntimeMcpItem {
  id: string;
  name: string;
  status: string;
  transport: string;
  tools: Array<{ name: string; description: string }>;
}

export default function McpHubPage() {
  const [tab, setTab] = useState<'runtime' | 'external'>('external');
  const [runtimeServers, setRuntimeServers] = useState<RuntimeMcpItem[]>([]);
  const [externalServers, setExternalServers] = useState<ExternalMcpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [transport, setTransport] = useState<'streamable_http' | 'sse'>('streamable_http');
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'header'>('none');
  const [secret, setSecret] = useState('');

  async function loadMcp() {
    setLoading(true);
    try {
      const data = await apiFetch<{ runtimeServers: RuntimeMcpItem[]; externalServers: ExternalMcpItem[] }>('/api/mcp');
      setRuntimeServers(data.runtimeServers);
      setExternalServers(data.externalServers);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal memuat MCP Hub.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMcp();
  }, []);

  async function handleAddExternal(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/mcp/external', {
        method: 'POST',
        body: JSON.stringify({ displayName, endpoint, transport, authType, secret: secret || undefined }),
      });
      setDisplayName('');
      setEndpoint('');
      setSecret('');
      setFeedback('Koneksi MCP eksternal berhasil ditambahkan (secret terenkripsi di server).');
      await loadMcp();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menambahkan MCP eksternal.');
    }
  }

  async function handleToggle(item: ExternalMcpItem) {
    await apiFetch(`/api/mcp/${item.id}/${item.enabled ? 'disable' : 'enable'}`, { method: 'POST' });
    await loadMcp();
  }

  async function handleTest(id: string) {
    try {
      const res = await apiFetch<{ message: string }>(`/api/mcp/${id}/test`, { method: 'POST' });
      setFeedback(res.message);
      await loadMcp();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Tes koneksi MCP gagal.');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus koneksi MCP eksternal ini?')) return;
    await apiFetch(`/api/mcp/${id}`, { method: 'DELETE' });
    await loadMcp();
  }

  return (
    <AppShell
      title="MCP Hub"
      topBarExtra={
        <button
          type="button"
          onClick={loadMcp}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Segarkan
        </button>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('external')}
            className={`rounded-xl px-4 py-2 text-xs font-semibold ${
              tab === 'external' ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/40' : 'glass-card text-slate-400'
            }`}
          >
            External MCP ({externalServers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('runtime')}
            className={`rounded-xl px-4 py-2 text-xs font-semibold ${
              tab === 'runtime' ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/40' : 'glass-card text-slate-400'
            }`}
          >
            Runtime MCP ({runtimeServers.length})
          </button>
        </div>

        {feedback && (
          <div className="glass-card rounded-2xl border-sky-400/30 px-4 py-3 text-xs text-sky-100">{feedback}</div>
        )}

        {tab === 'external' ? (
          <div className="grid gap-5 lg:grid-cols-3">
            <form onSubmit={handleAddExternal} className="glass-panel space-y-3 rounded-2xl p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Plus className="h-4 w-4 text-sky-400" /> Tambah External MCP
              </h2>
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nama tampilan (mis. GitHub MCP)"
                className="glass-input w-full rounded-xl px-3 py-2 text-xs text-white"
              />
              <input
                required
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://mcp.example.com/rpc"
                className="glass-input w-full rounded-xl px-3 py-2 text-xs text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={transport}
                  onChange={(e) => setTransport(e.target.value as 'streamable_http' | 'sse')}
                  className="glass-input rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="streamable_http" className="bg-slate-900">Streamable HTTP</option>
                  <option value="sse" className="bg-slate-900">SSE</option>
                </select>
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as 'none' | 'bearer' | 'header')}
                  className="glass-input rounded-xl px-3 py-2 text-xs text-white"
                >
                  <option value="none" className="bg-slate-900">Tanpa Auth</option>
                  <option value="bearer" className="bg-slate-900">Bearer Token</option>
                  <option value="header" className="bg-slate-900">Custom Header</option>
                </select>
              </div>
              {authType !== 'none' && (
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Secret token (write-only, terenkripsi)"
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs text-white"
                />
              )}
              <button
                type="submit"
                className="w-full rounded-xl bg-sky-400 py-2 text-xs font-semibold text-slate-950 hover:brightness-110"
              >
                Simpan Koneksi MCP
              </button>
            </form>

            <div className="space-y-3 lg:col-span-2">
              {externalServers.length === 0 ? (
                <div className="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">
                  Belum ada server MCP eksternal yang terdaftar.
                </div>
              ) : (
                externalServers.map((srv) => (
                  <div key={srv.id} className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Plug className="h-4 w-4 text-sky-400" />
                        <p className="font-semibold text-sm text-white">{srv.displayName}</p>
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                          {srv.config.transport}
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{srv.config.endpoint}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Status: <span className="text-slate-200">{srv.status}</span> · Secret:{' '}
                        {srv.hasSecret ? 'Tersimpan (masked)' : 'Tidak ada'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTest(srv.id)}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs hover:bg-white/15"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Tes
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(srv)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                          srv.enabled ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-slate-300'
                        }`}
                      >
                        <Power className="h-3.5 w-3.5" /> {srv.enabled ? 'Aktif' : 'Nonaktif'}
                      </button>
                      <button
                        type="button"
                        aria-label="Hapus MCP"
                        onClick={() => handleDelete(srv.id)}
                        className="rounded-lg bg-rose-500/15 p-1.5 text-rose-300 hover:bg-rose-500/25"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {runtimeServers.length === 0 ? (
              <div className="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">
                Belum ada server MCP aktif yang terdeteksi dari runtime upstream (periksa konfigurasi OVERDRIVE_BASE_URL).
              </div>
            ) : (
              runtimeServers.map((srv) => (
                <div key={srv.id} className="glass-card rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{srv.name}</p>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] text-emerald-300">
                      {srv.tools.length} tools · {srv.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
