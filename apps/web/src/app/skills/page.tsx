'use client';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Skill = { id: string; slug: string; description: string; status: string; manifest?: { instructionsMarkdown?: string } };
const catalog = [
  ['research-assistant', 'Riset', 'Bandingkan sumber dan rangkum temuan.', 'Pisahkan fakta dari dugaan. Cantumkan sumber dan keterbatasan.'],
  ['code-reviewer', 'Development', 'Review bug dan regresi kode.', 'Prioritaskan temuan yang bisa diverifikasi. Sertakan lokasi dan saran perbaikan.'],
  ['content-writer', 'Menulis', 'Bikin outline dan draf sesuai audiens.', 'Tanyakan target dan kanal bila belum jelas. Tawarkan draf dengan struktur yang mudah dibaca.'],
  ['meeting-notes', 'Produktivitas', 'Ubah catatan rapat jadi keputusan dan tindak lanjut.', 'Pisahkan keputusan dan tugas. Jangan berasumsi tentang penanggung jawab atau tenggat yang tidak disebutkan.'],
  ['document-review', 'Riset', 'Ringkas dokumen dan tandai klaim yang perlu dicek.', 'Gunakan rujukan bagian atau halaman jika tersedia. Tandai ketidakpastian.'],
  ['test-planner', 'Development', 'Susun skenario pengujian dan kasus batas.', 'Kelompokkan skenario berdasarkan risiko. Berikan hasil yang diharapkan untuk setiap skenario.'],
  ['copy-editor', 'Menulis', 'Rapikan bahasa tanpa mengubah maksud.', 'Pertahankan fakta dan gaya penulis. Jelaskan perubahan yang memengaruhi makna.'],
  ['project-planner', 'Produktivitas', 'Pecah pekerjaan jadi langkah yang bisa ditindaklanjuti.', 'Identifikasi dependensi, risiko, dan kriteria selesai. Tandai asumsi.'],
  ['data-summary', 'Analisis', 'Jelaskan pola dalam data yang diberikan.', 'Sebutkan satuan, nilai kosong, dan keterbatasan. Jangan mengarang angka.'],
];
const categories = ['Semua', ...new Set(catalog.map(([, category]) => category))];
export default function SkillsPage() {
  const [tab, setTab] = useState('Marketplace');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Semua');
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function load() { const result = await apiFetch<{ importedSkills: Skill[] }>('/api/skills'); setSkills(result.importedSkills ?? []); }
  useEffect(() => { void load().catch(() => setNotice('Gagal memuat skill terpasang.')); }, []);
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setNotice('');
    try { await fn(); await load(); setNotice(success); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Aksi gagal.'); }
    finally { setBusy(false); }
  }
  const install = (text: string) => apiFetch('/api/skills/import', { method: 'POST', body: JSON.stringify({ markdown: text }) });
  const visible = catalog.filter(([slug, group, description]) => (category === 'Semua' || category === group) && `${slug} ${group} ${description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <AppShell title="Skills Marketplace"><div className="mx-auto w-full max-w-5xl space-y-5">
    <div><h1 className="text-2xl font-semibold">Skills</h1><p className="text-sm text-[var(--muted)]">Pilih instruksi siap pakai atau impor SKILL.md sendiri.</p></div>
    <nav aria-label="Bagian Skills" className="flex flex-wrap gap-2">{['Marketplace', 'Terpasang', 'Impor'].map((item) => <button key={item} aria-pressed={tab === item} onClick={() => setTab(item)} className={`workspace-action ${tab === item ? 'workspace-primary' : ''}`}>{item}{item === 'Terpasang' ? ` (${skills.length})` : ''}</button>)}</nav>
    {notice && <p role="status" className="glass-card rounded-xl p-3">{notice}</p>}
    {tab === 'Marketplace' && <><div className="flex flex-wrap gap-2"><input aria-label="Cari skill" className="glass-input flex-1 rounded-xl p-3" placeholder="Cari skill…" value={query} onChange={(e) => setQuery(e.target.value)}/><select aria-label="Kategori" className="glass-input w-auto rounded-xl p-3" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((group) => <option key={group}>{group}</option>)}</select></div><p className="text-sm text-[var(--muted)]">{visible.length} skill · Katalog pilihan LEVHUB</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map(([slug, group, description, instructions]) => <article key={slug} className="glass-card space-y-3 rounded-2xl p-4"><p className="text-xs text-[var(--accent)]">{group}</p><h2 className="font-semibold">{slug}</h2><p className="text-sm text-[var(--muted)]">{description}</p><details><summary className="cursor-pointer text-sm">Lihat instruksi</summary><p className="mt-2 text-sm">{instructions}</p></details><button className="workspace-action workspace-primary" disabled={busy || skills.some((item) => item.slug === slug)} onClick={() => void run(() => install(`---\nname: ${slug}\ndescription: ${description}\nversion: 1.0.0\n---\n# ${slug}\n\n${instructions}\n`), 'Skill dipasang dalam status nonaktif.')}>{skills.some((item) => item.slug === slug) ? 'Terpasang' : 'Pasang'}</button></article>)}</div></>}
    {tab === 'Terpasang' && <div className="space-y-3">{skills.length === 0 && <p>Belum ada skill terpasang.</p>}{skills.map((skill) => <article className="glass-card space-y-2 rounded-xl p-4" key={skill.id}><h2 className="font-semibold">{skill.slug} · {skill.status === 'enabled' ? 'Aktif' : 'Nonaktif'}</h2><p className="text-sm">{skill.description}</p>{skill.manifest?.instructionsMarkdown && <details><summary>Lihat instruksi</summary><p className="whitespace-pre-wrap">{skill.manifest.instructionsMarkdown}</p></details>}<div className="flex flex-wrap gap-2"><button className="workspace-action" disabled={busy || skill.status === 'invalid'} onClick={() => void run(() => apiFetch(`/api/skills/${skill.id}/${skill.status === 'enabled' ? 'disable' : 'enable'}`, { method: 'POST' }), 'Status skill diperbarui.')}>{skill.status === 'enabled' ? 'Nonaktifkan' : 'Aktifkan'}</button><button className="workspace-action" disabled={busy} onClick={() => { if (confirm('Hapus skill ini?')) void run(() => apiFetch(`/api/skills/${skill.id}`, { method: 'DELETE' }), 'Skill dihapus.'); }}>Hapus</button></div></article>)}</div>}
    {tab === 'Impor' && <section className="glass-panel space-y-4 rounded-2xl p-4"><label className="block">Unggah SKILL.md atau ZIP<input className="mt-2 block max-w-full" type="file" accept=".md,.zip" disabled={busy} onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (!file) return; const data = new FormData(); data.append('file', file); void run(() => apiFetch('/api/skills/import', { method: 'POST', body: data }), 'Skill diimpor dalam status nonaktif.'); }}/></label><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await install(markdown); setMarkdown(''); }, 'Skill diimpor dalam status nonaktif.'); }}><label className="block">Atau tempel isi SKILL.md<textarea rows={8} className="glass-input mt-2 rounded-xl p-3" value={markdown} onChange={(e) => setMarkdown(e.target.value)}/></label><button className="workspace-action workspace-primary" disabled={busy || !markdown.trim()}>Validasi dan impor</button></form></section>}
  </div></AppShell>;
}
