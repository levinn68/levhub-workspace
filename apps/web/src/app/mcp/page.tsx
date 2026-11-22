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


function getIndonesianMcpDescription(item: MarketplaceItem): string {
  const key = `${item.name} ${item.description}`.toLowerCase();
  const curated: Array<[RegExp, string]> = [
    [/github/, 'Menghubungkan LEVHUB ke GitHub untuk mencari repositori, membaca dan mengelola file, memantau issue, serta membantu alur kerja pengembangan kode.'],
    [/gitlab/, 'Menghubungkan GitLab untuk mengakses proyek, repositori, issue, merge request, dan aktivitas pengembangan dalam satu alur kerja.'],
    [/filesystem|file.?system/, 'Memberi akses terkontrol ke file dan folder agar AI dapat membaca, mencari, membuat, serta mengelola berkas sesuai izin.'],
    [/postgres|postgresql/, 'Menghubungkan database PostgreSQL untuk membaca skema, menjalankan kueri, dan membantu analisis data.'],
    [/supabase/, 'Menghubungkan Supabase untuk mengelola database, tabel, autentikasi, dan layanan proyek Supabase.'],
    [/mysql/, 'Menghubungkan database MySQL untuk membaca struktur tabel, menjalankan kueri, dan mengambil data.'],
    [/sqlite/, 'Mengakses database SQLite untuk membaca struktur basis data dan menjalankan kueri lokal.'],
    [/brave.?search|web.?search/, 'Mencari informasi di web dan mengembalikan hasil pencarian yang relevan agar AI dapat melakukan riset dengan sumber terbaru.'],
    [/fetch|web.?content/, 'Mengambil isi halaman web dari URL tertentu sehingga AI dapat membaca dan merangkum konten situs.'],
    [/playwright|browser|puppeteer/, 'Mengendalikan browser untuk membuka halaman, menavigasi situs, mengisi formulir, dan mengambil informasi dari web.'],
    [/slack/, 'Menghubungkan Slack untuk mencari pesan, membaca percakapan, dan membantu mengelola komunikasi tim.'],
    [/discord/, 'Menghubungkan Discord untuk membaca informasi server, kanal, dan pesan serta membantu aktivitas komunitas.'],
    [/notion/, 'Menghubungkan Notion untuk mencari, membaca, dan mengelola halaman serta basis data workspace.'],
    [/linear/, 'Menghubungkan Linear untuk mencari dan mengelola issue, proyek, siklus kerja, serta pembaruan tugas tim.'],
    [/figma/, 'Menghubungkan Figma untuk menemukan file desain, membaca konteks desain, dan membantu alur kerja kolaborasi desain.'],
    [/sentry/, 'Mengakses data error dan performa dari Sentry untuk membantu menemukan bug serta menganalisis masalah aplikasi.'],
    [/cloudflare/, 'Mengelola layanan Cloudflare seperti DNS, Workers, jaringan, dan konfigurasi keamanan melalui integrasi MCP.'],
    [/vercel/, 'Mengakses proyek dan deployment Vercel untuk memeriksa status build, konfigurasi, serta proses rilis aplikasi.'],
    [/google.?drive|gdrive/, 'Menghubungkan Google Drive untuk mencari, membaca, dan mengelola dokumen serta file yang tersedia.'],
    [/memory/, 'Menyediakan penyimpanan memori agar AI dapat menyimpan dan mengambil informasi penting antarinteraksi.'],
    [/docker/, 'Membantu mengelola container dan resource Docker untuk kebutuhan pengembangan serta operasional aplikasi.'],
    [/kubernetes| kubectl/, 'Membantu memeriksa dan mengelola resource Kubernetes seperti pod, deployment, dan namespace.'],
    [/exa/, 'Melakukan pencarian web dan riset semantik untuk menemukan halaman serta sumber informasi yang relevan.'],
    [/apify/, 'Menghubungkan platform Apify untuk menjalankan aktor otomasi dan mengambil data dari situs atau layanan web.'],
  ];
  const match = curated.find(([pattern]) => pattern.test(key));
  if (match) return match[1];

  const category = item.category.toLowerCase();
  if (/database/.test(category)) return `Menghubungkan AI ke layanan database untuk membaca struktur data, menjalankan kueri, dan mengambil informasi yang dibutuhkan. Integrasi: ${item.name}.`;
  if (/browser|search/.test(category)) return `Membantu AI mencari, membuka, dan mengambil informasi dari web melalui layanan ${item.name}.`;
  if (/cloud|devops/.test(category)) return `Menghubungkan AI ke layanan cloud dan DevOps untuk membantu memeriksa serta mengelola resource dan alur deployment melalui ${item.name}.`;
  if (/productivity|communication/.test(category)) return `Menghubungkan AI ke aplikasi kerja dan komunikasi agar informasi serta aktivitas workspace dapat diakses melalui ${item.name}.`;
  if (/files|storage/.test(category)) return `Memungkinkan AI mencari, membaca, dan mengelola file pada layanan penyimpanan ${item.name}, sesuai kemampuan dan izin server.`;
  if (/design|media/.test(category)) return `Menghubungkan AI ke alat desain atau media ${item.name} untuk membantu mengakses aset dan mendukung alur kerja kreatif.`;
  if (/developer/.test(category)) return `Menyediakan integrasi alat pengembangan ${item.name} agar AI dapat membantu pekerjaan teknis dan pengelolaan proyek.`;
  return `Server MCP ${item.name} menyediakan integrasi ${item.category.toLowerCase()} agar AI dapat mengakses fungsi layanan terkait dari LEVHUB. Fitur yang tersedia mengikuti kemampuan server tersebut.`;
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
  const [marketSort, setMarketSort] = useState('stars');
  const [marketCursor, setMarketCursor] = useState<string | null>(null);
  const [marketCategory, setMarketCategory] = useState('All');
  const [marketItems, setMarketItems] = useState<MarketplaceItem[]>([]);
  const [marketCategories, setMarketCategories] = useState<string[]>(['All']);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketPartial, setMarketPartial] = useState(false);
  const [connectItem, setConnectItem] = useState<MarketplaceItem | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

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

  async function openMarketplaceConnect(item: MarketplaceItem) {
    const install = (item.install || {}) as any;
    const remotes = Array.isArray(install.remotes) ? install.remotes : [];
    const remote = remotes.find((r: any) => typeof r?.url === 'string' || typeof r?.endpoint === 'string') || null;
    let declaredEndpoint = remote?.url || remote?.endpoint || install.remoteUrl || '';
    let transportValue = String(remote?.type || install.transport || 'streamable_http').toLowerCase();
    let detail: any = null;

    // Resolve full connection metadata for HostedMCP and GitHub community listings.
    // GitHub repository URLs identify the package, not the MCP endpoint; use owner/name
    // only as a catalog lookup key and always take the endpoint from catalog metadata.
    let catalogSlug = item.id.startsWith('hosted:') ? item.id.slice('hosted:'.length) : '';
    if (!catalogSlug && item.repositoryUrl) {
      try {
        const repoUrl = new URL(item.repositoryUrl);
        if (repoUrl.hostname === 'github.com' || repoUrl.hostname === 'www.github.com') {
          const parts = repoUrl.pathname.split('/').filter(Boolean);
          if (parts.length >= 2) catalogSlug = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
        }
      } catch {
        // Ignore malformed repository URLs.
      }
    }
    if (!declaredEndpoint && catalogSlug) {
      try {
        detail = await apiFetch<any>(`/api/mcp/marketplace/detail?slug=${encodeURIComponent(catalogSlug)}`);
        declaredEndpoint = detail.endpoint || '';
        transportValue = String(detail.transport || transportValue).toLowerCase();
      } catch {
        // A repository URL is never treated as an MCP endpoint.
      }
    }

    const endpointCandidate = typeof declaredEndpoint === 'string' && /^https:\/\//i.test(declaredEndpoint) ? declaredEndpoint : '';
    const authHints = [...(Array.isArray(item.auth) ? item.auth : []), ...(Array.isArray(detail?.auth) ? detail.auth : [])].join(' ').toLowerCase();
    const requiresCredentials = /oauth|bearer|token|api.?key|header|environment variable|credential|auth required/.test(authHints);
    const packages = detail?.packages || install.packages || [];
    const envNames = (detail?.environmentVariables || []).map((entry: any) => String(entry?.name || '')).join(' ').toLowerCase();
    const suggestedHeader = /browser_use_api_key/.test(envNames) || /browser-use/.test(item.name.toLowerCase())
      ? 'X-Browser-Use-API-Key'
      : /api.?key/.test(authHints) ? 'X-API-Key' : 'Authorization';

    // A catalog entry with a real remote endpoint and no declared credentials
    // should connect in one click, not open a redundant manual configuration form.
    if (endpointCandidate && !requiresCredentials) {
      setFeedback(`Menghubungkan ${item.name}...`);
      try {
        const created = await apiFetch<ExternalMcpItem>('/api/mcp/external', {
          method: 'POST',
          body: JSON.stringify({
            displayName: item.name,
            endpoint: endpointCandidate,
            transport: transportValue.includes('sse') ? 'sse' : 'streamable_http',
            authType: 'none',
          }),
        });
        await apiFetch(`/api/mcp/${created.id}/test`, { method: 'POST' });
        await apiFetch(`/api/mcp/${created.id}/enable`, { method: 'POST' });
        await loadMcp();
        setFeedback(`${item.name} berhasil terhubung dan diaktifkan.`);
        setTab('external');
      } catch (err) {
        await loadMcp();
        setFeedback(err instanceof Error ? `Koneksi ${item.name} gagal: ${err.message}` : `Koneksi ${item.name} gagal. Periksa endpoint dan autentikasi server.`);
        setTab('external');
      }
      return;
    }
    const hasLocalInstall = Array.isArray(packages) && packages.length > 0;
    setDisplayName(item.name);
    setEndpoint(endpointCandidate);
    setTransport(transportValue.includes('sse') ? 'sse' : 'streamable_http');
    setAuthType(/api.?key/.test(authHints) ? 'header' : /bearer|oauth|token/.test(authHints) ? 'bearer' : 'none');
    setSecret('');
    setCustomHeaderName(suggestedHeader);
    setConnectError(!endpointCandidate
      ? hasLocalInstall || item.transport.some(t => t.toLowerCase() === 'stdio')
        ? 'Server ini hanya menyediakan instalasi lokal (STDIO/package). LEVHUB belum memiliki local MCP runtime, jadi server ini belum bisa dihubungkan langsung. Gunakan Repository untuk petunjuk instalasi.'
        : 'Katalog belum menyediakan remote endpoint yang dapat dipakai. URL repositori atau halaman katalog bukan endpoint MCP dan tidak boleh dimasukkan sebagai pengganti.'
      : null);
    setConnectItem(item);
  }

  async function submitMarketplaceConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!endpoint.trim()) { setConnectError('URL MCP endpoint wajib diisi.'); return; }
    const created = await handleAddExternal(e);
    if (created?.id) await handleTest(created.id);
    setConnectItem(null);
    setTab('external');
  }

  async function handleAddExternal(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const created = await apiFetch<ExternalMcpItem>('/api/mcp/external', {
        method: 'POST',
        body: JSON.stringify({ displayName, endpoint, transport, authType, secret: secret || undefined, customHeaderName: authType === 'header' ? customHeaderName : undefined }),
      });
      setDisplayName('');
      setEndpoint('');
      setSecret('');
      setCustomHeaderName('Authorization');
      setFeedback('Koneksi MCP eksternal berhasil ditambahkan (secret terenkripsi di server).');
      await loadMcp();
      return created;
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal menambahkan MCP eksternal.');
      return null;
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

        {connectItem && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="mcp-connect-title">
            <form onSubmit={submitMarketplaceConnect} className="glass-panel w-full max-w-lg space-y-3 rounded-2xl border border-indigo-200/20 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3"><div><h2 id="mcp-connect-title" className="text-base font-semibold text-white">{endpoint ? `Hubungkan ${connectItem.name}` : `Koneksi belum tersedia`}</h2><p className="mt-1 text-xs text-slate-400">{endpoint ? "Endpoint Remote MCP ditemukan. Masukkan kredensial yang diminta server jika diperlukan." : connectItem.name}</p></div><button type="button" onClick={() => setConnectItem(null)} className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300">Tutup</button></div>
              {endpoint && connectError && <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100">{connectError}</div>}
              {endpoint ? <>
                <label className="block text-xs text-slate-300">Nama koneksi<input required value={displayName} onChange={e => setDisplayName(e.target.value)} className="glass-input mt-1 w-full rounded-xl px-3 py-2 text-sm text-white"/></label>
                <label className="block text-xs text-slate-300">MCP endpoint URL<input required type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://server.example.com/mcp" className="glass-input mt-1 w-full rounded-xl px-3 py-2 text-sm text-white"/></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-300">Transport<select value={transport} onChange={e => setTransport(e.target.value as 'streamable_http' | 'sse')} className="glass-input mt-1 w-full rounded-xl px-3 py-2 text-xs text-white"><option value="streamable_http" className="bg-slate-900">Streamable HTTP</option><option value="sse" className="bg-slate-900">SSE (legacy)</option></select></label><label className="text-xs text-slate-300">Autentikasi<select value={authType} onChange={e => setAuthType(e.target.value as 'none' | 'bearer' | 'header')} className="glass-input mt-1 w-full rounded-xl px-3 py-2 text-xs text-white"><option value="none" className="bg-slate-900">Tanpa auth</option><option value="bearer" className="bg-slate-900">Bearer token</option><option value="header" className="bg-slate-900">Custom header</option></select></label></div>
                {authType === 'header' && <input value={customHeaderName} onChange={e => setCustomHeaderName(e.target.value)} placeholder="X-API-Key" className="glass-input w-full rounded-xl px-3 py-2 text-xs text-white"/>}
                {authType !== 'none' && <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="API key / token" className="glass-input w-full rounded-xl px-3 py-2 text-xs text-white"/>}
                <p className="text-[10px] leading-4 text-slate-500">Token disimpan terenkripsi. Setelah ditambahkan, jalankan Tes koneksi di tab External MCP sebelum mengaktifkannya.</p>
              </> : <div className="space-y-3">
                <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[.07] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><span className="h-2 w-2 rounded-full bg-amber-300"/> Belum tersedia untuk koneksi langsung</div>
                  <p className="mt-2 text-xs leading-5 text-slate-300">Katalog hanya memberikan informasi repositori atau paket. Belum ada endpoint Remote MCP yang bisa dihubungkan ke LEVHUB.</p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">Dukungan server lokal (STDIO) memerlukan Local MCP Runtime.</p>
                </div>
                {connectItem.repositoryUrl && <a href={connectItem.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs text-slate-200 hover:bg-white/15">Buka repository <ArrowUpRight className="h-3.5 w-3.5"/></a>}
              </div>}
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setConnectItem(null)} className="rounded-xl bg-white/10 px-4 py-2 text-xs text-slate-200">{endpoint ? 'Batal' : 'Tutup'}</button>{endpoint && <button type="submit" className="rounded-xl bg-indigo-400 px-4 py-2 text-xs font-semibold text-slate-950">Simpan &amp; Connect</button>}</div>
            </form>
          </div>
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
                <div className="grid grid-cols-2 gap-2"><select value={marketProvider} onChange={e => setMarketProvider(e.target.value)} className="glass-input rounded-xl px-3 py-2 text-xs text-white"><option value="all" className="bg-slate-900">Semua sumber</option><option value="hosted" className="bg-slate-900">Katalog luas</option><option value="official" className="bg-slate-900">Registry</option><option value="github" className="bg-slate-900">GitHub</option></select><select value={marketSort} onChange={e => setMarketSort(e.target.value)} className="glass-input rounded-xl px-3 py-2 text-xs text-white"><option value="stars" className="bg-slate-900">Stars terbanyak</option><option value="quality" className="bg-slate-900">Peringkat kualitas</option><option value="downloads" className="bg-slate-900">Downloads</option><option value="new" className="bg-slate-900">Terbaru</option></select></div>
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
                  <p className="mt-3 line-clamp-3 flex-1 text-xs leading-5 text-slate-400">{getIndonesianMcpDescription(item)}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{item.version}</span>{item.popularity?.stars ? <span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">★ {item.popularity.stars.toLocaleString()}</span> : null}{item.popularity?.downloads ? <span className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{item.popularity.downloads.toLocaleString()} downloads</span> : null}{item.transport.slice(0,2).map(t => <span key={t} className="rounded-md bg-white/[.06] px-2 py-1 text-[9px] text-slate-300">{t}</span>)}</div>
                  <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => openMarketplaceConnect(item)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-400 px-3 py-2 text-[10px] font-semibold text-slate-950 hover:bg-indigo-300"><Plug className="h-3 w-3"/> Connect</button>{item.repositoryUrl && <a href={item.repositoryUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-white/10 px-3 py-2 text-[10px] text-slate-200 hover:bg-white/15">Repository ↗</a>}</div>
                </article>)}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-[11px] leading-5 text-slate-500">Urutan populer memakai sinyal publik seperti stars dan download, bukan data pemakaian privat. Server lokal/stdio tetap memerlukan runtime host.</p>{marketCursor ? <button type="button" onClick={async () => { setMarketLoading(true); try { const params = new URLSearchParams({ q: marketQuery, category: marketCategory, provider: "hosted", sort: marketSort, limit: "50", cursor: marketCursor }); const data = await apiFetch<{items: MarketplaceItem[]; nextCursor?: string | null}>("/api/mcp/marketplace?" + params.toString()); setMarketItems(prev => [...prev, ...(data.items || [])]); setMarketCursor(data.nextCursor || null); } catch (err) { setFeedback(err instanceof Error ? err.message : "Gagal memuat halaman berikutnya."); } finally { setMarketLoading(false); } }} className="rounded-xl bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15">Muat lebih banyak</button> : null}</div>
          </section>
        ) : tab === 'external' ? (
          <section className="space-y-4">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/70 p-5 sm:p-6">
              <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-xl"><p className="text-[10px] font-semibold uppercase tracking-[.22em] text-sky-300">Koneksi workspace</p><h2 className="mt-2 text-xl font-semibold tracking-tight text-white">External MCP</h2><p className="mt-1 text-xs leading-5 text-slate-400">Kelola server MCP yang terhubung ke LEVHUB. Uji koneksi sebelum mengaktifkan tools untuk AI.</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right"><p className="text-2xl font-semibold tabular-nums text-white">{externalServers.length}</p><p className="text-[10px] text-slate-400">koneksi tersimpan</p></div>
              </div>
              <details className="group relative mt-5 rounded-2xl border border-white/10 bg-black/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5"><span className="flex items-center gap-2 text-sm font-medium text-white"><Plus className="h-4 w-4 text-sky-300"/> Tambah server manual</span><span className="text-xs text-slate-400 transition group-open:rotate-180">⌄</span></summary>
                <form onSubmit={handleAddExternal} className="grid gap-3 border-t border-white/10 p-4 sm:grid-cols-2">
                  <label className="block text-[11px] text-slate-400">Nama server<input required value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Contoh: GitHub" className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm text-white"/></label>
                  <label className="block text-[11px] text-slate-400">Endpoint MCP<input required type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://host.example.com/mcp" className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm text-white"/></label>
                  <label className="block text-[11px] text-slate-400">Transport<select value={transport} onChange={e => setTransport(e.target.value as 'streamable_http' | 'sse')} className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm text-white"><option value="streamable_http" className="bg-slate-900">Streamable HTTP</option><option value="sse" className="bg-slate-900">SSE (legacy)</option></select></label>
                  <label className="block text-[11px] text-slate-400">Autentikasi<select value={authType} onChange={e => setAuthType(e.target.value as 'none' | 'bearer' | 'header')} className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm text-white"><option value="none" className="bg-slate-900">Tanpa autentikasi</option><option value="bearer" className="bg-slate-900">Bearer token</option><option value="header" className="bg-slate-900">Custom header</option></select></label>
                  {authType === 'header' && <label className="block text-[11px] text-slate-400">Nama header<input required value={customHeaderName} onChange={e => setCustomHeaderName(e.target.value)} placeholder="X-API-Key" className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm text-white"/></label>}
                  {authType !== 'none' && <label className="block text-[11px] text-slate-400">Token / API key<input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Disimpan terenkripsi" className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm text-white"/></label>}
                  <div className="flex items-center justify-between gap-3 sm:col-span-2"><p className="max-w-sm text-[10px] leading-4 text-slate-500">Gunakan URL endpoint MCP resmi, bukan URL halaman katalog atau dokumentasi.</p><button type="submit" className="shrink-0 rounded-xl bg-sky-400 px-4 py-2.5 text-xs font-semibold text-slate-950 shadow-lg shadow-sky-950/30 hover:bg-sky-300">Simpan koneksi</button></div>
                </form>
              </details>
            </div>
            <div className="flex items-center justify-between gap-3 px-1"><div><h3 className="text-sm font-semibold text-white">Server terhubung</h3><p className="mt-1 text-[11px] text-slate-500">Tes, aktifkan, atau putuskan koneksi.</p></div><button type="button" onClick={loadMcp} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-[11px] text-slate-300 hover:bg-white/[.08]"><RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}/> Segarkan</button></div>
            {externalServers.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 bg-white/[.02] px-5 py-10 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[.05]"><Plug className="h-5 w-5 text-slate-400"/></div><p className="mt-3 text-sm font-medium text-white">Belum ada server MCP</p><p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-slate-500">Hubungkan server dari Marketplace atau tambahkan endpoint MCP secara manual.</p></div> : (
              <div className="grid gap-3 xl:grid-cols-2">{externalServers.map(srv => { const isCatalogUrl = Boolean(srv.config.endpoint?.includes('hostedmcp.org/servers/')); const isError = isCatalogUrl || srv.status.toLowerCase().includes('error') || srv.status.toLowerCase().includes('fail'); return <article key={srv.id} className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/95 to-slate-950/95 p-4 shadow-xl shadow-black/10">
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${isError ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : srv.enabled ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-sky-400/20 bg-sky-400/10 text-sky-300'}`}><Plug className="h-4 w-4"/></div><div className="min-w-0"><h4 className="truncate text-sm font-semibold text-white">{srv.displayName}</h4><p className="mt-1 truncate text-[10px] text-slate-500">{srv.config.transport || 'Streamable HTTP'}</p></div></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium ${isError ? 'border-rose-400/20 bg-rose-400/10 text-rose-300' : srv.enabled ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/[.04] text-slate-400'}`}>{isCatalogUrl ? 'URL katalog, bukan endpoint' : isError ? 'Perlu diperiksa' : srv.enabled ? 'Aktif' : 'Nonaktif'}</span></div>
                <p className="mt-3 truncate rounded-lg bg-black/20 px-3 py-2 font-mono text-[10px] text-slate-400">{srv.config.endpoint}</p>
                {isCatalogUrl && <div role="alert" className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[.07] px-3 py-2.5"><p className="text-[11px] font-semibold text-amber-200">Alamat yang tersimpan adalah halaman katalog HostedMCP.</p><p className="mt-1 text-[10px] leading-4 text-slate-400">Itu bukan alamat server MCP yang bisa diajak berkomunikasi. Koneksi ini belum dapat digunakan. Hapus entri ini, lalu tambahkan endpoint MCP resmi dari penyedia server.</p></div>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] text-slate-500">Autentikasi: {srv.hasSecret ? 'Kredensial tersimpan' : 'Tidak ada kredensial'}</p><div className="flex items-center gap-2"><button type="button" onClick={() => handleTest(srv.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.05] px-3 py-2 text-[10px] font-medium text-slate-200 hover:bg-white/10"><CheckCircle2 className="h-3.5 w-3.5"/> Uji koneksi</button><button type="button" onClick={() => handleToggle(srv)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold ${srv.enabled ? 'bg-emerald-400/15 text-emerald-200' : 'bg-sky-400 text-slate-950'}`}><Power className="h-3.5 w-3.5"/>{srv.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button><button type="button" aria-label={`Hapus ${srv.displayName}`} onClick={() => handleDelete(srv.id)} className="rounded-lg border border-rose-400/15 bg-rose-400/10 p-2 text-rose-300 hover:bg-rose-400/20"><Trash2 className="h-3.5 w-3.5"/></button></div></div>
              </article>; })}</div>
            )}
          </section>
        ) : (
          <div className="space-y-3">
              {runtimeServers.map((srv) => (
                <div key={srv.id} className="glass-card rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{srv.name}</p>
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] text-emerald-300">
                      {srv.tools.length} tools · {srv.status}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
