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

interface MarketplaceItem {
  id: string; name: string; description: string; version: string; source: string; category: string;
  repositoryUrl: string | null; websiteUrl: string | null; transport: string[]; auth: string[];
  install: any; verified: boolean; popularity?: { stars?: number; downloads?: number };
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
  const [marketProvider, setMarketProvider] = useState('all');
  const [marketSort, setMarketSort] = useState('quality');
  const [marketCursor, setMarketCursor] = useState<string | null>(null);
  const [marketCategory, setMarketCategory] = useState('All');
  const [marketItems, setMarketItems] = useState<MarketplaceItem[]>([]);
  const [marketCategories, setMarketCategories] = useState<string[]>(['All']);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketPartial, setMarketPartial] = useState(false);

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

  useEffect(() => { loadMcp(); }, []);
  useEffect(() => { if (tab === 'marketplace') loadMarketplace(); }, [tab, marketQuery, marketCategory, marketProvider, marketSort]);


  async function loadMarketplace() {
    setMarketLoading(true);
    try {
      const params = new URLSearchParams({ q: marketQuery, category: marketCategory, provider: marketProvider, sort: marketSort, limit: '50' });
      const data = await apiFetch<{ items: MarketplaceItem[]; categories: string[]; total: number; nextCursor?: string | null; providerStatus?: { partial?: boolean } }>(`/api/mcp/marketplace?${params.toString()}`);
      setMarketItems(data.items || []);
      setMarketCursor(data.nextCursor || null);
      setMarketCategories(data.categories || ['All']);
      setMarketTotal(data.total || 0);
      setMarketPartial(Boolean(data.providerStatus?.partial));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal memuat katalog MCP.');
    } finally { setMarketLoading(false); }
  }

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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-base font-semibold">MCP Marketplace</h2><p className="mt-1 text-xs text-slate-400">Discovery multi-provider: Official Registry, community directory, dan GitHub.</p></div>
                <div className="text-right"><div className="text-lg font-semibold text-white">{marketTotal.toLocaleString('id-ID')}</div><div className="text-[10px] text-slate-500">server ditemukan</div></div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_190px]">
                <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={marketQuery} onChange={e => setMarketQuery(e.target.value)} placeholder="Cari GitHub, database, browser..." className="glass-input w-full rounded-xl py-3 pl-10 pr-3 text-sm"/></div>
                <div className="grid grid-cols-2 gap-2"><select value={marketProvider} onChange={e => setMarketProvider(e.target.value)} className="glass-input rounded-xl px-3 py-2 text-xs text-white"><option value="all" className="bg-slate-900">Semua sumber</option><option value="hosted" className="bg-slate-900">Katalog luas</option><option value="official" className="bg-slate-900">Registry</option><option value="github" className="bg-slate-900">GitHub</option></select><select value={marketSort} onChange={e => setMarketSort(e.target.value)} className="glass-input rounded-xl px-3 py-2 text-xs text-white"><option value="quality" className="bg-slate-900">Paling populer</option><option value="stars" className="bg-slate-900">GitHub stars</option><option value="downloads" className="bg-slate-900">Downloads</option><option value="new" className="bg-slate-900">Terbaru</option></select></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {marketCategories.map(cat => <button key={cat} type="button" onClick={() => setMarketCategory(cat)} className={`rounded-full px-3 py-1.5 text-[11px] ${marketCategory === cat ? 'bg-indigo-300/20 text-indigo-100 ring-1 ring-indigo-200/30' : 'bg-white/[.05] text-slate-400 hover:bg-white/10'}`}>{cat}</button>)}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span>{marketLoading ? 'Memuat dari provider...' : marketPartial ? 'Sebagian provider belum merespons' : 'Katalog diperbarui langsung dari sumber provider'}</span><button type="button" onClick={loadMarketplace} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-slate-200"><RefreshCw className={`h-3 w-3 ${marketLoading ? 'animate-spin' : ''}`}/> Refresh</button></div>
            </div>
            {marketLoading && marketItems.length === 0 ? <div className="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">Menghubungkan ke provider MCP...</div> : marketItems.length === 0 ? <div className="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">Tidak ada server ditemukan. Coba provider atau kata kunci lain.</div> : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {marketItems.map(item => <article key={item.id} className="glass-card flex min-w-0 flex-col rounded-2xl p-4 transition hover:border-indigo-200/30">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white">{item.name}</h3><p className="mt-1 text-[10px] text-indigo-200">{item.category}</p></div><span className="shrink-0 rounded-full bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{item.verified ? 'Registry active' : 'Community'}</span></div>
                  <p className="mt-3 line-clamp-3 flex-1 text-xs leading-5 text-slate-400">{item.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{item.version}</span>{item.popularity?.stars ? <span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">★ {item.popularity.stars.toLocaleString()}</span> : null}{item.popularity?.downloads ? <span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{item.popularity.downloads.toLocaleString()} downloads</span> : null}{item.transport.slice(0,2).map(t => <span key={t} className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{t}</span>)}</div>
                  <div className="mt-4 flex flex-wrap gap-2">{item.repositoryUrl && <a href={item.repositoryUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-3 py-2 text-[10px] text-slate-200 hover:bg-white/15">Repository ↗</a>}{item.websiteUrl && <a href={item.websiteUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-3 py-2 text-[10px] text-slate-200 hover:bg-white/15">Docs ↗</a>}</div>
                </article>)}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-[11px] leading-5 text-slate-500">Urutan populer memakai sinyal publik seperti stars dan download, bukan data pemakaian privat. Server lokal/stdio tetap memerlukan runtime host.</p>{marketCursor ? <button type="button" onClick={async () => { setMarketLoading(true); try { const params = new URLSearchParams({ q: marketQuery, category: marketCategory, provider: "hosted", sort: marketSort, limit: "50", cursor: marketCursor }); const data = await apiFetch<{items: MarketplaceItem[]; nextCursor?: string | null}>("/api/mcp/marketplace?" + params.toString()); setMarketItems(prev => [...prev, ...(data.items || [])]); setMarketCursor(data.nextCursor || null); } catch (err) { setFeedback(err instanceof Error ? err.message : "Gagal memuat halaman berikutnya."); } finally { setMarketLoading(false); } }} className="rounded-xl bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15">Muat lebih banyak</button> : null}</div>
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
