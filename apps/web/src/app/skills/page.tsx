'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Upload, Power, Trash2, FileCode2 } from 'lucide-react';
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
      <div className="grid gap-5 lg:grid-cols-3">
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
      </div>
    </AppShell>
  );
}
