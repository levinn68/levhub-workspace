'use client';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Remote = { url: string; type?: string; headers?: unknown[] };
type Listing = { id: string; name: string; description: string; install?: { remotes?: Remote[] } };
type Connection = { id: string; displayName: string; enabled: boolean; status: string };
const github = { name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', transport: 'streamable_http', auth: 'bearer' };
const blank = { name: '', url: '', transport: 'streamable_http', auth: 'none' };
function json(body: unknown) { return { method: 'POST', body: JSON.stringify(body) }; }
export default function MCPPage() {
  const [items, setItems] = useState<Listing[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<typeof blank | null>(null);
  const [secret, setSecret] = useState('');
  const [header, setHeader] = useState('X-API-Key');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [catalogError, setCatalogError] = useState('');
  async function load() { const data = await apiFetch<{ externalServers: Connection[] }>('/api/mcp'); setConnections(data.externalServers ?? []); }
  useEffect(() => { void load().catch(() => setNotice('Gagal memuat koneksi tersimpan.')); }, []);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setCatalogError('');
      void apiFetch<{ items: Listing[]; providerStatus?: { loaded: number } }>(`/api/mcp/marketplace?provider=official&limit=50&q=${encodeURIComponent(query)}`).then((data) => {
        if (!current) return;
        setItems(data.items ?? []);
        if (data.providerStatus?.loaded === 0) setCatalogError('Registry sedang tidak tersedia. GitHub dan koneksi manual tetap bisa dipilih.');
      }).catch(() => { if (current) { setItems([]); setCatalogError('Gagal memuat registry MCP.'); } });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);
  function open(config: typeof blank) { setSecret(''); setHeader('X-API-Key'); setNotice(''); setForm(config); }
  async function action(fn: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await fn(); await load(); }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Koneksi MCP gagal.'); await load().catch(() => {}); }
    finally { setBusy(false); }
  }
  async function connect() {
    if (!form) return;
    const created = await apiFetch<Connection>('/api/mcp/external', json({ displayName: form.name.trim(), endpoint: form.url.trim(), transport: form.transport, authType: form.auth, secret: form.auth !== 'none' ? secret.trim() : undefined, customHeaderName: form.auth === 'header' ? header.trim() : undefined }));
    setForm(null); setSecret('');
    await apiFetch(`/api/mcp/${created.id}/test`, { method: 'POST' });
    await apiFetch(`/api/mcp/${created.id}/enable`, { method: 'POST' });
    setNotice(`${created.displayName} terhubung dan aktif.`);
  }
  const listings = items.flatMap((item) => (Array.isArray(item.install?.remotes) ? item.install.remotes : []).filter((remote) => /^https:\/\//i.test(remote?.url ?? '') && !/[{}]/.test(remote.url) && ['sse', 'streamable-http', 'streamable_http'].includes(remote.type ?? '')).map((remote) => ({ item, remote })));
  return <AppShell title="MCP Marketplace" topBarExtra={<button className="workspace-action" disabled={busy} onClick={() => open(blank)}>Tambah server</button>}>
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div><h1 className="text-2xl font-semibold">Hubungkan layanan</h1><p className="text-sm text-[var(--muted)]">Katalog ini hanya menampilkan konektor dengan endpoint remote. Repo GitHub dan paket STDIO bukan endpoint.</p></div>
      {notice && <p role="status" className="glass-card rounded-xl p-3">{notice}</p>}
      {form && <form className="glass-card grid gap-3 rounded-2xl p-4" onSubmit={(e) => { e.preventDefault(); void action(connect); }}>
        <fieldset className="grid gap-3" disabled={busy}>
          <label>Nama<input required className="glass-input rounded-lg p-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
          <label>URL MCP resmi<input required type="url" className="glass-input rounded-lg p-2" value={form.url} onChange={(e) => {setSecret('');setForm({ ...form, url: e.target.value });}}/></label>
          <label>Transport<select className="glass-input rounded-lg p-2" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}><option value="streamable_http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
          <label>Autentikasi<select className="glass-input rounded-lg p-2" value={form.auth} onChange={(e) => {setSecret('');setForm({ ...form, auth: e.target.value });}}><option value="none">Tanpa token</option><option value="bearer">Bearer token</option><option value="header">Header API key</option></select></label>
          {form.auth === 'header' && <label>Nama header<input required className="glass-input rounded-lg p-2" value={header} onChange={(e) => setHeader(e.target.value)}/></label>}
          {form.auth !== 'none' && <label>Token / API key<input required type="password" autoComplete="off" className="glass-input rounded-lg p-2" value={secret} onChange={(e) => setSecret(e.target.value)}/></label>}
          <p className="text-sm text-[var(--muted)]">Pakai token dengan izin minimum. Server yang hanya mendukung login OAuth belum bisa dihubungkan lewat formulir ini.</p>
          <div className="flex gap-2"><button type="submit" className="workspace-action workspace-primary">Simpan, uji & aktifkan</button><button type="button" className="workspace-action" onClick={() => {setForm(null);setSecret('');}}>Batal</button></div>
        </fieldset>
      </form>}
      <input aria-label="Cari konektor MCP" className="glass-input rounded-xl p-3" placeholder="Cari konektor remote…" value={query} onChange={(e) => setQuery(e.target.value)}/>
      {catalogError && <p role="status">{catalogError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {'github'.includes(query.trim().toLowerCase()) && <article className="glass-card rounded-xl p-4"><h2 className="font-semibold">GitHub</h2><p className="my-2 text-sm text-[var(--muted)]">Konektor resmi · Bearer token GitHub</p><button className="workspace-action" disabled={busy} onClick={() => open(github)}>Hubungkan</button></article>}
        {listings.map(({ item, remote }, index) => <article key={`${item.id}:${index}`} className="glass-card rounded-xl p-4"><h2 className="font-semibold break-words">{item.name}</h2><p className="my-2 text-sm text-[var(--muted)]">{item.description}</p><button className="workspace-action" disabled={busy} onClick={() => open({ name: item.name.slice(0, 100), url: remote.url, transport: remote.type === 'sse' ? 'sse' : 'streamable_http', auth: remote.headers?.length ? 'header' : 'none' })}>Atur koneksi</button></article>)}
      </div>
      <section className="space-y-3"><h2 className="font-semibold">Koneksi tersimpan</h2>{!connections.length && <p className="text-sm text-[var(--muted)]">Belum ada koneksi.</p>}{connections.map((entry) => <article key={entry.id} className="glass-card space-y-2 rounded-xl p-4"><p>{entry.displayName} · {entry.enabled ? 'Aktif' : 'Nonaktif'} · {entry.status}</p><div className="flex flex-wrap gap-2"><button className="workspace-action" disabled={busy} onClick={() => void action(async () => { await apiFetch(`/api/mcp/${entry.id}/test`, { method: 'POST' }); setNotice('Tes koneksi berhasil.'); })}>Uji</button><button className="workspace-action" disabled={busy || (!entry.enabled && entry.status !== 'healthy')} onClick={() => void action(async () => { await apiFetch(`/api/mcp/${entry.id}/${entry.enabled ? 'disable' : 'enable'}`, { method: 'POST' }); })}>{entry.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button><button className="workspace-action" disabled={busy} onClick={() => { if (confirm('Hapus koneksi ini?')) void action(async () => { await apiFetch(`/api/mcp/${entry.id}`, { method: 'DELETE' }); }); }}>Hapus</button></div></article>)}</section>
    </div>
  </AppShell>;
}
