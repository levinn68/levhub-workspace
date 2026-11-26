'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

type Skill = { id: string; slug: string; description: string; status: string; version: string | null; manifest?: { instructionsMarkdown?: string; warnings?: string[] } };
type Entry = { slug: string; category: string; description: string; instructions: string };

const catalog: Entry[] = [
  { slug: 'research-assistant', category: 'Riset', description: 'Riset terstruktur dan perbandingan sumber.', instructions: 'Pecah pertanyaan menjadi sub-pertanyaan. Bedakan fakta, dugaan, dan hal yang belum diketahui. Cantumkan sumber serta keterbatasan.' },
  { slug: 'document-review', category: 'Riset', description: 'Ringkas dokumen dan tandai klaim yang perlu dicek.', instructions: 'Rujuk bagian atau halaman bila tersedia. Tandai ketidakpastian dan jangan mengarang kutipan.' },
  { slug: 'code-reviewer', category: 'Development', description: 'Review bug, regresi, dan risiko keamanan.', instructions: 'Prioritaskan temuan yang bisa diverifikasi. Sertakan lokasi kode, dampak, saran perbaikan, dan langkah verifikasi.' },
  { slug: 'test-planner', category: 'Development', description: 'Susun skenario pengujian dan kasus batas.', instructions: 'Kelompokkan skenario berdasarkan risiko. Jelaskan hasil yang diharapkan dan kondisi yang tidak diuji.' },
  { slug: 'content-writer', category: 'Menulis', description: 'Outline dan draf sesuai audiens serta kanal.', instructions: 'Tanyakan audiens, tujuan, dan kanal bila belum jelas. Susun struktur yang mudah dipindai dan hindari klaim berlebih.' },
  { slug: 'copy-editor', category: 'Menulis', description: 'Rapikan bahasa tanpa mengubah maksud.', instructions: 'Pertahankan fakta dan gaya penulis. Jelaskan perubahan yang bisa memengaruhi makna.' },
  { slug: 'meeting-notes', category: 'Produktivitas', description: 'Ubah catatan rapat jadi keputusan dan tindak lanjut.', instructions: 'Pisahkan keputusan, tugas, dan pertanyaan terbuka. Jangan mengarang penanggung jawab atau tenggat.' },
  { slug: 'project-planner', category: 'Produktivitas', description: 'Pecah pekerjaan jadi langkah yang bisa ditindaklanjuti.', instructions: 'Sebutkan dependensi, risiko, kriteria selesai, dan asumsi yang dipakai.' },
  { slug: 'data-summary', category: 'Analisis', description: 'Jelaskan pola dalam data yang diberikan.', instructions: 'Sebut satuan, nilai kosong, dan keterbatasan data. Jangan mengarang angka yang tidak ada.' },
];
const markdownFor = ({ slug, description, instructions }: Entry) => `---\nname: ${slug}\ndescription: ${description}\nversion: 1.0.0\n---\n\n# ${slug}\n\n${instructions}\n`;
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--line)] px-3 text-sm font-medium disabled:opacity-50';

export default function SkillsPage() {
  const [tab, setTab] = useState<'marketplace' | 'installed' | 'import'>('marketplace');
  const [skills, setSkills] = useState<Skill[]>();
  const [skillsError, setSkillsError] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Semua');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [paste, setPaste] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setSkillsError(false);
    try { setSkills((await apiFetch<{ importedSkills: Skill[] }>('/api/skills')).importedSkills ?? []); }
    catch { setSkillsError(true); setSkills([]); }
  }, []);
  useEffect(() => { void load(); }, [load, attempt]);

  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setNotice('');
    try { await fn(); await load(); setNotice(success); }
    catch (err) { setNotice(err instanceof Error ? err.message : 'Aksi skill gagal.'); }
    finally { setBusy(false); }
  }
  const install = (entry: Entry) => act(() => apiFetch('/api/skills/import', { method: 'POST', body: JSON.stringify({ markdown: markdownFor(entry) }) }), `${entry.slug} dipasang dan masih nonaktif.`);

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    const data = new FormData();
    data.append('file', selected);
    void act(() => apiFetch('/api/skills/import', { method: 'POST', body: data }), `${selected.name} diimpor dan masih nonaktif.`);
  }

  function submitPaste(event: FormEvent) {
    event.preventDefault();
    if (!paste.trim()) return;
    void act(async () => { await apiFetch('/api/skills/import', { method: 'POST', body: JSON.stringify({ markdown: paste }) }); setPaste(''); }, 'SKILL.md diimpor dan masih nonaktif.');
  }

  const categories = ['Semua', ...new Set(catalog.map(({ category: group }) => group))];
  const entries = catalog.filter((entry) => (category === 'Semua' || entry.category === category) && `${entry.slug} ${entry.category} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const installed = (slug: string) => skills?.some((skill) => skill.slug === slug) ?? false;

  return <AppShell title="Skills"><div className="mx-auto max-w-4xl space-y-5">
    <header><h1 className="text-2xl font-semibold">Skills</h1><p className="mt-1 text-sm text-[var(--muted)]">Instruksi siap pakai untuk chat. Skill baru masuk dalam status nonaktif.</p></header>
    <nav aria-label="Bagian Skills" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={tab === 'marketplace'} className={`${button} ${tab === 'marketplace' ? '!border-[var(--accent)] text-[var(--accent)]' : ''}`} onClick={() => setTab('marketplace')}>Katalog</button>
      <button type="button" aria-pressed={tab === 'installed'} className={`${button} ${tab === 'installed' ? '!border-[var(--accent)] text-[var(--accent)]' : ''}`} onClick={() => setTab('installed')}>Terpasang ({skills?.length ?? 0})</button>
      <button type="button" aria-pressed={tab === 'import'} className={`${button} ${tab === 'import' ? '!border-[var(--accent)] text-[var(--accent)]' : ''}`} onClick={() => setTab('import')}>Impor</button>
    </nav>
    {notice && <p role="status" className="rounded-lg border border-[var(--line)] p-3 text-sm">{notice}</p>}
    {skillsError && <button type="button" className={button} onClick={() => setAttempt((n) => n + 1)}>Muat ulang skill</button>}

    {tab === 'marketplace' && <section className="space-y-4">
      <div className="flex flex-wrap gap-2"><input type="search" aria-label="Cari skill" className="glass-input min-w-0 flex-1 rounded-lg p-3" placeholder="Cari skill" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Kategori" className="glass-input rounded-lg p-3" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((group) => <option key={group}>{group}</option>)}</select></div>
      <p className="text-sm text-[var(--muted)]">{entries.length} skill dari katalog bawaan LEVHUB</p>
      <ul className="grid gap-3 sm:grid-cols-2">{entries.map((entry) => <li key={entry.slug} className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="text-xs text-[var(--accent)]">{entry.category}</p><h2 className="break-words font-semibold">{entry.slug}</h2><p className="flex-1 text-sm text-[var(--muted)]">{entry.description}</p>
        <details><summary className="cursor-pointer text-sm">Lihat instruksi</summary><p className="mt-2 whitespace-pre-wrap text-sm">{entry.instructions}</p></details>
        <button type="button" className={`${button} !border-[var(--accent)] text-[var(--accent)]`} disabled={busy || installed(entry.slug)} onClick={() => void install(entry)}>{installed(entry.slug) ? 'Terpasang' : 'Pasang'}</button>
      </li>)}</ul>
      {!entries.length && <p className="text-sm text-[var(--muted)]">Tidak ada skill yang cocok.</p>}
    </section>}

    {tab === 'installed' && <section className="space-y-3">
      {!skills && !skillsError && <p role="status" className="text-sm">Memuat skill…</p>}
      {skills?.length === 0 && <p className="text-sm text-[var(--muted)]">Belum ada skill terpasang.</p>}
      {skills?.map((skill) => <article key={skill.id} className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="break-words font-semibold">{skill.slug}</h2><span className="text-xs">{skill.status === 'enabled' ? 'Aktif' : skill.status === 'invalid' ? 'Tidak valid' : 'Nonaktif'}{skill.version ? ` · v${skill.version}` : ''}</span></div>
        <p className="text-sm">{skill.description}</p>
        <details><summary className="cursor-pointer text-sm">Lihat instruksi</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{skill.manifest?.instructionsMarkdown || JSON.stringify(skill.manifest, null, 2)}</pre></details>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy || skill.status === 'invalid'} onClick={() => void act(() => apiFetch(`/api/skills/${skill.id}/${skill.status === 'enabled' ? 'disable' : 'enable'}`, { method: 'POST' }), skill.status === 'enabled' ? `${skill.slug} dinonaktifkan.` : `${skill.slug} diaktifkan.`)}>{skill.status === 'enabled' ? 'Nonaktifkan' : 'Aktifkan'}</button>
          <button type="button" className={`${button} text-rose-300`} disabled={busy} onClick={() => { if (window.confirm(`Hapus ${skill.slug}?`)) void act(() => apiFetch(`/api/skills/${skill.id}`, { method: 'DELETE' }), `${skill.slug} dihapus.`); }}>Hapus</button>
        </div>
      </article>)}
    </section>}

    {tab === 'import' && <section className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div><h2 className="font-semibold">Unggah paket</h2><p className="mt-1 text-sm text-[var(--muted)]">Terima SKILL.md atau ZIP yang berisi SKILL.md.</p><input ref={file} type="file" accept=".md,.zip" className="hidden" onChange={upload} /><button type="button" className={button} disabled={busy} onClick={() => file.current?.click()}>Pilih file</button></div>
      <form className="space-y-2" onSubmit={submitPaste}><label htmlFor="skill-paste" className="text-sm font-medium">Atau tempel isi SKILL.md</label><textarea id="skill-paste" className="glass-input w-full rounded-lg p-3 font-mono text-sm" rows={9} value={paste} onChange={(event) => setPaste(event.target.value)} /><button type="submit" className={`${button} !border-[var(--accent)] text-[var(--accent)]`} disabled={busy || !paste.trim()}>Validasi dan impor</button></form>
      <p className="text-xs text-[var(--muted)]">Skill diimpor nonaktif. Baca instruksinya sebelum mengaktifkan.</p>
    </section>}
  </div></AppShell>;
}
