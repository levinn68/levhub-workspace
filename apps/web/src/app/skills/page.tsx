'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Upload, Power, Trash2, FileCode2, Search, ArrowDownToLine, WandSparkles, ShieldCheck, Code2 } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { apiFetch } from '@/lib/api';

interface SkillItem {
  id: string;
  slug: string;
  version: string | null;
  description: string;
  source: string;
  status: string;
  manifest?: { instructionsMarkdown?: string; warnings?: string[] };
}

export default function SkillsHubPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [markdownInput, setMarkdownInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [tab, setTab] = useState<'marketplace' | 'installed'>('marketplace');
  const [marketQuery, setMarketQuery] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);

  async function loadSkills() {
    try {
      const res = await apiFetch<{ importedSkills: SkillItem[] }>('/api/skills');
      setSkills(res.importedSkills);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal memuat Skills.');
    }
  }

  useEffect(() => {
    loadSkills();
  }, []);

  async function installMarketplaceSkill(skill: {slug:string;description:string;markdown:string}) {
    setInstalling(skill.slug); setFeedback(null);
    try { const res = await apiFetch<{skill:SkillItem}>('/api/skills/import',{method:'POST',body:JSON.stringify({markdown:skill.markdown})}); setFeedback(`Skill ${res.skill.slug} berhasil dipasang dan masih nonaktif sampai kamu mengaktifkannya.`); await loadSkills(); setTab('installed'); }
    catch(err) { setFeedback(err instanceof Error ? err.message : 'Instalasi Skill gagal.'); }
    finally { setInstalling(null); }
  }

  async function handlePasteImport(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiFetch<{ skill: SkillItem; validation: { warnings: string[] } }>('/api/skills/import', {
        method: 'POST',
        body: JSON.stringify({ markdown: markdownInput }),
      });
      setMarkdownInput('');
      setFeedback(
        `Skill "${res.skill.slug}" berhasil divalidasi & diimpor dalam status nonaktif.` +
          (res.validation.warnings.length ? ` Peringatan: ${res.validation.warnings.join(' ')}` : ''),
      );
      await loadSkills();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Validasi SKILL.md gagal.');
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch<{ skill: SkillItem }>('/api/skills/import', {
        method: 'POST',
        body: form,
      });
      setFeedback(`Paket "${res.skill.slug}" lolos validasi keamanan dan siap diaktifkan.`);
      await loadSkills();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Gagal mengimpor paket Skill.');
    } finally {
      e.target.value = '';
    }
  }

  async function handleToggle(skill: SkillItem) {
    const action = skill.status === 'enabled' ? 'disable' : 'enable';
    await apiFetch(`/api/skills/${skill.id}/${action}`, { method: 'POST' });
    await loadSkills();
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus Skill ini dari LEVHUB?')) return;
    await apiFetch(`/api/skills/${id}`, { method: 'DELETE' });
    await loadSkills();
  }

  return (
    <AppShell title="Skills Hub">
      <div className="mb-4 flex flex-wrap gap-2"><button type="button" onClick={() => setTab('marketplace')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${tab === 'marketplace' ? 'bg-indigo-300/20 text-indigo-100 ring-1 ring-indigo-200/30' : 'glass-card text-slate-300'}`}>Skills Marketplace</button><button type="button" onClick={() => setTab('installed')} className={`rounded-xl px-4 py-2 text-xs font-semibold ${tab === 'installed' ? 'bg-indigo-300/20 text-indigo-100 ring-1 ring-indigo-200/30' : 'glass-card text-slate-300'}`}>Skill Terpasang ({skills.length})</button></div>
      {feedback && <div role="status" className="glass-card mb-4 rounded-xl px-4 py-3 text-xs text-slate-200">{feedback}</div>}
      {tab === 'marketplace' ? <section className="space-y-4"><div className="glass-panel rounded-2xl p-4 sm:p-5"><div className="flex items-center gap-3"><div className="rounded-2xl bg-gradient-to-br from-indigo-300/25 to-sky-300/10 p-3 text-indigo-100"><WandSparkles className="h-5 w-5"/></div><div><h2 className="text-base font-semibold">Skills Marketplace</h2><p className="mt-1 text-xs text-slate-400">Temukan kemampuan baru untuk LEVHUB.</p></div></div><div className="relative mt-4"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={marketQuery} onChange={e=>setMarketQuery(e.target.value)} placeholder="Cari writing, coding, research..." className="glass-input w-full rounded-xl py-3 pl-10 pr-3 text-sm"/></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        {slug:'research-assistant',description:'Menyusun riset terstruktur, membandingkan sumber, dan merangkum temuan.',category:'Research',icon:'research',markdown:'---\nname: research-assistant\ndescription: Menyusun riset terstruktur, membandingkan sumber, dan merangkum temuan.\nversion: 1.0.0\n---\n# Research Assistant\n\nSaat diminta melakukan riset:\n1. Pecah pertanyaan menjadi sub-pertanyaan.\n2. Bedakan fakta, inferensi, dan hal yang belum diketahui.\n3. Bandingkan sumber dan cantumkan rujukan yang tersedia.\n4. Sajikan ringkasan, temuan utama, dan keterbatasan.\n'},
        {slug:'code-reviewer',description:'Meninjau kode, menemukan bug, risiko keamanan, dan saran perbaikan.',category:'Development',icon:'code',markdown:'---\nname: code-reviewer\ndescription: Meninjau kode, menemukan bug, risiko keamanan, dan saran perbaikan.\nversion: 1.0.0\n---\n# Code Reviewer\n\nSaat meninjau kode:\n1. Prioritaskan bug, regresi, dan celah keamanan.\n2. Sertakan lokasi kode dan alasan dampaknya.\n3. Bedakan temuan pasti dari dugaan.\n4. Berikan patch minimal dan langkah verifikasi.\n'},
        {slug:'content-writer',description:'Membuat naskah, outline, dan konten sesuai audiens serta platform.',category:'Content',icon:'write',markdown:'---\nname: content-writer\ndescription: Membuat naskah, outline, dan konten sesuai audiens serta platform.\nversion: 1.0.0\n---\n# Content Writer\n\nSaat membuat konten:\n1. Tentukan audiens, tujuan, dan platform.\n2. Buat hook yang relevan dan tidak menyesatkan.\n3. Gunakan struktur yang mudah dipindai.\n4. Sesuaikan nada bahasa dengan brief pengguna.\n'}
      ].filter(s=>`${s.slug} ${s.description} ${s.category}`.toLowerCase().includes(marketQuery.toLowerCase())).map(s=><article key={s.slug} className="glass-card flex flex-col rounded-2xl p-4"><div className="flex items-center justify-between"><span className="rounded-2xl bg-gradient-to-br from-indigo-300/20 to-sky-300/10 p-3 text-indigo-100">{s.icon==='code'?<Code2 className="h-5 w-5"/>:s.icon==='write'?<FileCode2 className="h-5 w-5"/>:<ShieldCheck className="h-5 w-5"/>}</span><span className="rounded-full bg-white/[.06] px-2.5 py-1 text-[10px] text-slate-300">{s.category}</span></div><h3 className="mt-4 text-sm font-semibold">{s.slug}</h3><p className="mt-2 flex-1 text-xs leading-5 text-slate-400">{s.description}</p><button type="button" disabled={installing===s.slug || skills.some(x=>x.slug===s.slug)} onClick={()=>installMarketplaceSkill(s)} className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-300 to-sky-300 px-3 py-2.5 text-xs font-semibold text-slate-950 disabled:opacity-50">{skills.some(x=>x.slug===s.slug)?'Sudah terpasang':installing===s.slug?'Memasang...':'Pasang Skill'} <ArrowDownToLine className="h-3.5 w-3.5"/></button></article>)}</div><p className="text-[11px] text-slate-500">Katalog awal bawaan LEVHUB. Skill marketplace eksternal berbasis registry/repository akan ditambahkan setelah sumber katalog dan mekanisme sinkronisasi dikonfigurasi.</p></section> : <div className="grid gap-5 lg:grid-cols-3">
        <div className="glass-panel space-y-4 rounded-2xl p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Upload className="h-4 w-4 text-sky-400" /> Impor Skill (ZIP / SKILL.md)
          </h2>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-center text-xs text-slate-300 hover:border-sky-400/50">
            <span>Unggah file `.zip` atau `SKILL.md`</span>
            <span className="mt-1 text-[11px] text-slate-500">Validasi anti path-traversal & zip-bomb aktif</span>
            <input type="file" accept=".zip,.md" onChange={handleFileUpload} className="hidden" />
          </label>

          <form onSubmit={handlePasteImport} className="space-y-2.5">
            <label className="block text-xs text-slate-300">Atau tempel konten SKILL.md:</label>
            <textarea
              rows={7}
              value={markdownInput}
              onChange={(e) => setMarkdownInput(e.target.value)}
              placeholder={`---\nname: contoh-skill\ndescription: Ringkasan fungsi skill\nversion: 1.0.0\n---\n# Instruksi\n...`}
              className="glass-input w-full rounded-xl p-3 font-mono text-xs text-white"
            />
            <button
              type="submit"
              disabled={!markdownInput.trim()}
              className="w-full rounded-xl bg-sky-400 py-2 text-xs font-semibold text-slate-950 hover:brightness-110 disabled:opacity-40"
            >
              Validasi & Impor Skill
            </button>
          </form>
        </div>

        <div className="space-y-3 lg:col-span-2">
          {feedback && (
            <div className="glass-card rounded-2xl border-sky-400/30 px-4 py-3 text-xs text-sky-100">{feedback}</div>
          )}

          {skills.length === 0 ? (
            <div className="glass-panel rounded-2xl p-8 text-center text-xs text-slate-400">
              Belum ada Skill yang diimpor. Skill baru selalu masuk dalam status nonaktif sampai Anda mengaktifkannya.
            </div>
          ) : (
            skills.map((sk) => (
              <div key={sk.id} className="glass-card rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-indigo-400" />
                      <h3 className="text-sm font-semibold text-white">{sk.slug}</h3>
                      {sk.version && (
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                          v{sk.version}
                        </span>
                      )}
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{sk.status}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-300">{sk.description}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInspectId(inspectId === sk.id ? null : sk.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs hover:bg-white/15"
                    >
                      <FileCode2 className="h-3.5 w-3.5" /> Inspeksi
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggle(sk)}
                      disabled={sk.status === 'invalid'}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                        sk.status === 'enabled' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-slate-300'
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" /> {sk.status === 'enabled' ? 'Aktif' : 'Aktifkan'}
                    </button>
                    <button
                      type="button"
                      aria-label="Hapus Skill"
                      onClick={() => handleDelete(sk.id)}
                      className="rounded-lg bg-rose-500/15 p-1.5 text-rose-300 hover:bg-rose-500/25"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {inspectId === sk.id && (
                  <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-black/50 p-3 font-mono text-[11px] text-slate-300">
                    {sk.manifest?.instructionsMarkdown || JSON.stringify(sk.manifest, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>}
    </AppShell>
  );
}
