'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Connection = { id: string; displayName: string; config: { transport?: string; endpoint?: string }; hasSecret: boolean; status: string; enabled: boolean; lastHealthCheck: string | null };
type Listing = { id: string; name: string; description: string; category: string; repositoryUrl: string | null; install?: { remotes?: Array<{ url?: string; type?: string; headers?: unknown[] }> }; transport: string[] };
type Detail = { endpoint?: string | null; transport?: string; auth?: string[]; packages?: unknown[]; environmentVariables?: Array<{ name?: string }> };
type Transport = 'streamable_http' | 'sse';
type AuthType = 'none' | 'bearer' | 'header';
type Draft = { name: string; endpoint: string; transport: Transport; auth: AuthType; header: string; secret: string; notice: string };

const github: Draft = { name: 'GitHub', endpoint: 'https://api.githubcopilot.com/mcp/', transport: 'streamable_http', auth: 'bearer', header: 'Authorization', secret: '', notice: 'GitHub MCP membutuhkan personal access token dengan izin minimum.' };
const empty = (): Draft => ({ name: '', endpoint: '', transport: 'streamable_http', auth: 'none', header: 'X-API-Key', secret: '', notice: '' });
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 text-sm font-medium disabled:opacity-50';
const endpointOf = (item: Listing) => {
  const remote = (item.install?.remotes ?? []).find((entry) => typeof entry?.url === 'string' && /^https:\/\//i.test(entry.url!) && !/[{}]/.test(entry.url!));
  return remote ? { url: remote.url!, transport: remote.type?.toLowerCase().includes('sse') ? 'sse' as Transport : 'streamable_http' as Transport, hasHeaders: Boolean(remote.headers?.length) } : null;
};

export default function MCPPage() {
  const [tab, setTab] = useState<'marketplace' | 'connections'>('marketplace');
  const [connections, setConnections] = useState<Connection[]>();
  const [connectionsError, setConnectionsError] = useState(false);
  const [items, setItems] = useState<Listing[]>([]);
  const [query, setQuery] = useState('');
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [resolving, setResolving] = useState('');
  const form = useRef<HTMLFormElement>(null);

  const loadConnections = useCallback(async () => {
    setConnectionsError(false);
    try {
      const data = await apiFetch<{ externalServers: Connection[] }>('/api/mcp');
      setConnections(data.externalServers ?? []);
    } catch { setConnectionsError(true); setConnections([]); }
  }, []);
  useEffect(() => { void loadConnections(); }, [loadConnections]);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setMarketLoading(true); setMarketError('');
      apiFetch<{ items: Listing[]; providerStatus?: { loaded: number } }>(`/api/mcp/marketplace?provider=official&limit=50&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((data) => {
          if (!live) return;
          setItems(data.items ?? []);
          if (data.providerStatus?.loaded === 0) setMarketError('Registry sedang tidak tersedia. Koneksi manual tetap bisa dipakai.');
        })
        .catch((err) => { if (live && err?.name !== 'AbortError') { setItems([]); setMarketError('Katalog MCP gagal dimuat.'); } })
        .finally(() => { if (live) setMarketLoading(false); });
    }, 300);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [query]);

  function open(next: Draft) { setFeedback(''); setDraft(next); setTimeout(() => form.current?.scrollIntoView({ block: 'nearest' }), 0); }

  async function choose(item: Listing) {
    const remote = endpointOf(item);
    setFeedback('');
    if (remote && !remote.hasHeaders && !/token|api.?key|bearer|oauth/i.test(`${item.description} ${(item.transport ?? []).join(' ')}`)) {
      open({ ...empty(), name: item.name.slice(0, 100), endpoint: remote.url, transport: remote.transport, notice: 'Endpoint remote ditemukan. Periksa lalu simpan untuk menguji koneksi.' });
      return;
    }
    setResolving(item.id);
    let detail: Detail | null = null;
    const slug = item.id.startsWith('hosted:') ? item.id.slice(7) : '';
    if (slug) {
      try { detail = await apiFetch<Detail>(`/api/mcp/marketplace/detail?slug=${encodeURIComponent(slug)}`); } catch { detail = null; }
    }
    setResolving('');
    const endpoint = remote?.url ?? detail?.endpoint ?? '';
    const auth = (detail?.auth ?? []).join(' ').toLowerCase();
    open({
      name: item.name.slice(0, 100), endpoint, transport: remote?.transport ?? (detail?.transport?.includes('sse') ? 'sse' : 'streamable_http'),
      auth: remote?.hasHeaders || /api.?key|header/.test(auth) ? 'header' : /bearer|token|oauth/.test(auth) ? 'bearer' : 'none',
      header: 'X-API-Key',
      secret: '',
      notice: endpoint
        ? 'Periksa endpoint dan masukkan kredensial yang diminta server.'
        : (detail?.packages ?? []).length > 0
          ? 'Server ini hanya tersedia sebagai paket lokal (STDIO). LEVHUB belum punya local runtime, jadi belum bisa dihubungkan langsung.'
          : 'Katalog tidak mencantumkan endpoint remote MCP yang bisa dipakai. URL repositori bukan endpoint server.',
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy || !draft.endpoint.trim()) return;
    setBusy(true); setFeedback('');
    let created: Connection | undefined;
    try {
      created = await apiFetch<Connection>('/api/mcp/external', { method: 'POST', body: JSON.stringify({
        displayName: draft.name.trim(), endpoint: draft.endpoint.trim(), transport: draft.transport,
        authType: draft.auth, secret: draft.auth === 'none' ? undefined : draft.secret.trim() || undefined,
        customHeaderName: draft.auth === 'header' ? draft.header.trim() : undefined,
      }) });
      await apiFetch(`/api/mcp/${created.id}/test`, { method: 'POST' });
      await apiFetch(`/api/mcp/${created.id}/enable`, { method: 'POST' });
      setDraft(undefined);
      setFeedback(`${created.displayName} tersambung dan aktif.`);
      await loadConnections();
    } catch (err) {
      setFeedback(err instanceof Error ? `Belum tersambung: ${err.message}` : 'Koneksi MCP gagal diuji.');
      if (created) { setDraft(undefined); await loadConnections(); setTab('connections'); }
    } finally { setBusy(false); }
  }

  async function act(fn: () => Promise<string>) {
    setBusy(true); setFeedback('');
    try { setFeedback(await fn()); } catch (err) { setFeedback(err instanceof Error ? err.message : 'Aksi MCP gagal.'); }
    finally { await loadConnections(); setBusy(false); }
  }

  return <AppShell title="MCP"><div className="mx-auto max-w-4xl space-y-5">
    <header><h1 className="text-2xl font-semibold">MCP</h1><p className="mt-1 text-sm text-[var(--muted)]">Hubungkan tool remote ke chat. Koneksi baru tidak aktif sampai tes berhasil.</p></header>
    <nav aria-label="Bagian MCP" className="flex flex-wrap gap-2">{(['marketplace', 'connections'] as const).map((value) => <button key={value} type="button" aria-pressed={tab === value} className={`${button} ${tab === value ? '!border-[var(--accent)] text-[var(--accent)]' : ''}`} onClick={() => setTab(value)}>{value === 'marketplace' ? 'Temukan server' : `Koneksi (${connections?.length ?? 0})`}</button>)}<button type="button" className={button} onClick={() => open(empty())}>Tambah manual</button></nav>

    {feedback && <p role="status" className="rounded-lg border border-[var(--line)] p-3 text-sm">{feedback}</p>}

    {draft && <form ref={form} className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4" onSubmit={(event) => void save(event)}>
      <h2 className="font-semibold">{draft.name || 'Server MCP baru'}</h2>
      {draft.notice && <p className="text-sm text-[var(--muted)]">{draft.notice}</p>}
      <label className="block text-sm">Nama<input className="glass-input mt-1 w-full rounded-lg p-2" required maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="block text-sm">Endpoint MCP<input className="glass-input mt-1 w-full rounded-lg p-2" required type="url" placeholder="https://server.example.com/mcp" value={draft.endpoint} onChange={(event) => { setDraft({ ...draft, endpoint: event.target.value }); }} /></label>
      {!/^https:\/\//i.test(draft.endpoint) && draft.endpoint.trim() && <p className="text-sm text-amber-300">Endpoint harus dimulai dengan https://.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Transport<select className="glass-input mt-1 w-full rounded-lg p-2" value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value as Transport })}><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
        <label className="block text-sm">Autentikasi<select className="glass-input mt-1 w-full rounded-lg p-2" value={draft.auth} onChange={(event) => setDraft({ ...draft, auth: event.target.value as AuthType, secret: '' })}><option value="none">Tanpa token</option><option value="bearer">Bearer token</option><option value="header">Header API key</option></select></label>
      </div>
      {draft.auth === 'header' && <label className="block text-sm">Nama header<input className="glass-input mt-1 w-full rounded-lg p-2" required value={draft.header} onChange={(event) => setDraft({ ...draft, header: event.target.value })} /></label>}
      {draft.auth !== 'none' && <label className="block text-sm">Token / API key<input className="glass-input mt-1 w-full rounded-lg p-2" type="password" autoComplete="off" required value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} /></label>}
      <p className="text-xs text-[var(--muted)]">Pakai token dengan izin minimum. Server yang hanya mendukung login OAuth belum bisa dihubungkan dari formulir ini.</p>
      <div className="flex flex-wrap gap-2"><button className={`${button} !border-[var(--accent)] text-[var(--accent)]`} disabled={busy || !draft.name.trim() || !draft.endpoint.trim() || (draft.auth !== 'none' && !draft.secret.trim())}>{busy ? 'Menguji…' : 'Simpan, uji, dan aktifkan'}</button><button type="button" className={button} disabled={busy} onClick={() => setDraft(undefined)}>Batal</button></div>
    </form>}

    {tab === 'marketplace' ? <section className="space-y-4">
      <input type="search" aria-label="Cari server MCP" className="glass-input w-full rounded-lg p-3" placeholder="Cari server MCP" value={query} onChange={(event) => setQuery(event.target.value)} />
      {marketLoading && <p role="status" className="text-sm text-[var(--muted)]">Memuat katalog…</p>}
      {marketError && <p role="status" className="text-sm">{marketError}</p>}
      {!marketLoading && !marketError && !items.length && <p className="text-sm text-[var(--muted)]">Tidak ada server yang cocok. Coba kata kunci lain atau tambahkan endpoint manual.</p>}
      <ul className="space-y-3">{items.map((item) => { const remote = endpointOf(item); return <li key={item.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 break-words font-semibold">{item.name}</h2><span className="text-xs text-[var(--muted)]">{item.category}</span></div>
        <p className="mt-2 break-words text-sm text-[var(--muted)]">{item.description}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">{remote ? `Endpoint remote · ${remote.transport === 'sse' ? 'SSE' : 'Streamable HTTP'}` : 'Tidak ada endpoint remote tercantum'}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || resolving === item.id} onClick={() => void choose(item)}>{resolving === item.id ? 'Memeriksa…' : remote ? 'Hubungkan' : 'Lihat detail'}</button>{item.repositoryUrl && <a className={button} href={item.repositoryUrl} target="_blank" rel="noreferrer">Repositori</a>}</div>
      </li>; })}</ul>
      <p className="text-xs text-[var(--muted)]">Hanya server dengan endpoint remote yang bisa langsung dihubungkan. Server paket lokal (STDIO) butuh runtime tambahan.</p>
    </section> : <section className="space-y-3">
      {connectionsError && <button type="button" className={button} onClick={() => void loadConnections()}>Muat ulang koneksi</button>}
      {!connections && !connectionsError && <p role="status" className="text-sm">Memuat koneksi…</p>}
      {connections?.length === 0 && <p className="text-sm text-[var(--muted)]">Belum ada server MCP tersimpan.</p>}
      {connections?.map((entry) => <article key={entry.id} className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 break-words font-semibold">{entry.displayName}</h2><span className="text-xs">{entry.enabled ? 'Aktif' : 'Nonaktif'} · {entry.status}</span></div>
        <p className="break-all font-mono text-xs text-[var(--muted)]">{entry.config.endpoint}</p>
        <p className="text-xs text-[var(--muted)]">{entry.hasSecret ? 'Kredensial tersimpan' : 'Tanpa kredensial'}{entry.lastHealthCheck ? ` · Dicek ${new Date(entry.lastHealthCheck).toLocaleString('id-ID')}` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void act(async () => { await apiFetch(`/api/mcp/${entry.id}/test`, { method: 'POST' }); return 'Tes koneksi berhasil.'; })}>Uji</button>
          <button type="button" className={button} disabled={busy} onClick={() => void act(async () => { await apiFetch(`/api/mcp/${entry.id}/${entry.enabled ? 'disable' : 'enable'}`, { method: 'POST' }); return entry.enabled ? `${entry.displayName} dinonaktifkan.` : `${entry.displayName} diaktifkan.`; })}>{entry.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button>
          <button type="button" className={`${button} text-rose-300`} disabled={busy} onClick={() => { if (window.confirm(`Hapus koneksi ${entry.displayName}?`)) void act(async () => { await apiFetch(`/api/mcp/${entry.id}`, { method: 'DELETE' }); return `${entry.displayName} dihapus.`; }); }}>Hapus</button>
        </div>
      </article>)}
    </section>}
  </div></AppShell>;
}
