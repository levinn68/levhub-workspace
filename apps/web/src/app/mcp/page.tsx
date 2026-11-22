'use client';

import React, { useEffect, useState } from 'react';
import { Plug, Plus, Trash2, CheckCircle2, Power, RefreshCw, Search, Github, Database, Globe, Cloud, ArrowUpRight } from 'lucide-react';
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
  const [tab, setTab] = useState<'runtime' | 'external' | 'marketplace'>('marketplace');
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
  const [customHeaderName, setCustomHeaderName] = useState('Authorization');
  const [marketQuery, setMarketQuery] = useState('');

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
        body: JSON.stringify({ displayName, endpoint, transport, authType, secret: secret || undefined, customHeaderName: authType === 'header' ? customHeaderName : undefined }),
      });
      setDisplayName('');
      setEndpoint('');
      setSecret('');
      setCustomHeaderName('Authorization');
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTab('marketplace')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${tab === 'marketplace' ? 'bg-indigo-300/20 text-indigo-100 ring-1 ring-indigo-200/30' : 'glass-card text-slate-300'}`}>Marketplace</button>
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

        {tab === 'marketplace' ? (
          <section className="space-y-4">
            <div className="glass-panel rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Temukan MCP Server</h2><p className="mt-1 text-xs text-slate-400">Katalog konektor pilihan. Periksa metode autentikasi sebelum menghubungkan.</p></div><span className="rounded-full bg-violet-300/10 px-3 py-1 text-[11px] text-violet-100">MCP Directory</span></div>
              <div className="relative mt-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={marketQuery} onChange={e => setMarketQuery(e.target.value)} placeholder="Cari GitHub, database, browser..." className="glass-input w-full rounded-xl py-3 pl-10 pr-3 text-sm"/></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {name:'GitHub MCP',category:'Developer tools',desc:'Akses repository, issue, pull request, dan workflow GitHub.',endpoint:'https://api.githubcopilot.com/mcp/',transport:'streamable_http' as const,auth:'bearer' as const,Icon:Github,tag:'GitHub'},
                {name:'Custom MCP Server',category:'Universal',desc:'Hubungkan server MCP milikmu melalui Streamable HTTP atau SSE.',endpoint:'',transport:'streamable_http' as const,auth:'none' as const,Icon:Globe,tag:'Custom'},
                {name:'Database MCP',category:'Data',desc:'Template konektor database. Gunakan endpoint resmi dari penyedia database.',endpoint:'',transport:'streamable_http' as const,auth:'header' as const,Icon:Database,tag:'Template'},
                {name:'Cloud MCP',category:'Infrastructure',desc:'Template konektor layanan cloud dengan autentikasi header khusus.',endpoint:'',transport:'streamable_http' as const,auth:'header' as const,Icon:Cloud,tag:'Template'}
              ].filter(item => `${item.name} ${item.category} ${item.desc}`.toLowerCase().includes(marketQuery.toLowerCase())).map(item => <article key={item.name} className="glass-card flex flex-col rounded-2xl p-4 transition hover:-translate-y-0.5 hover:border-indigo-200/30"><div className="flex items-start justify-between"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-300/20 to-sky-300/10 text-indigo-100"><item.Icon className="h-5 w-5"/></div><span className="rounded-full bg-white/[.06] px-2.5 py-1 text-[10px] text-slate-300">{item.tag}</span></div><h3 className="mt-4 text-sm font-semibold">{item.name}</h3><p className="mt-1 text-[11px] text-indigo-200">{item.category}</p><p className="mt-2 flex-1 text-xs leading-5 text-slate-400">{item.desc}</p><button type="button" onClick={() => {setDisplayName(item.name);setEndpoint(item.endpoint);setTransport(item.transport);setAuthType(item.auth);setCustomHeaderName('Authorization');setSecret('');setTab('external');}} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-300 to-sky-300 px-3 py-2.5 text-xs font-semibold text-slate-950">Konfigurasi koneksi <ArrowUpRight className="h-3.5 w-3.5"/></button></article>)}
            </div>
            <p className="text-[11px] leading-5 text-slate-500">Catatan: katalog ini berisi template konektor, bukan klaim bahwa seluruh server sudah diverifikasi atau mendukung OAuth otomatis. OAuth belum diimplementasikan pada backend saat ini.</p>
          </section>
        ) : tab === 'external' ? (
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
              {authType === 'header' && <input required value={customHeaderName} onChange={e => setCustomHeaderName(e.target.value)} placeholder="Nama header (mis. Authorization, X-API-Key)" className="glass-input w-full rounded-xl px-3 py-2 text-xs text-white" />}
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
