'use client';

import { useId } from 'react';

export type PanelModel = { id: string; displayName: string; providerName: string; available: boolean };
export type PanelSelection = { models: string[]; finalModel: string };
type Entry = { model: string; text: string; usage: { input: number; output: number; total: number } | null };
export type PanelResult = { opinions: Entry[]; discussion: Entry[]; final: Entry };

export function PanelControls({ catalog, value, onChange, busy }: {
  catalog: PanelModel[];
  value: PanelSelection;
  onChange: (value: PanelSelection) => void;
  busy: boolean;
}) {
  const id = useId();
  return (
    <fieldset disabled={busy} className="glass-panel space-y-4 p-4">
      <legend className="px-2 font-semibold">Panel Diskusi</legend>
      <p className="text-sm text-[var(--muted)]">Pilih 2–4 model untuk diskusi paralel dan satu model untuk jawaban final.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalog.filter((model) => model.available).map((model) => {
          const selected = value.models.includes(model.id);
          return (
            <label key={model.id} className="glass-card flex min-w-0 items-start gap-3 rounded-xl p-3 text-sm">
              <input type="checkbox" className="mt-1 accent-sky-300" checked={selected} disabled={!selected && value.models.length >= 4}
                onChange={(event) => onChange({ ...value, models: event.target.checked ? [...value.models, model.id] : value.models.filter((entry) => entry !== model.id) })} />
              <span className="min-w-0 break-words">{model.displayName}<span className="block text-xs text-[var(--muted)]">{model.providerName}</span></span>
            </label>
          );
        })}
      </div>
      {!catalog.some((model) => model.available) && <p className="text-sm" role="status">Belum ada model yang tersedia.</p>}
      <label htmlFor={id} className="block text-sm font-medium">Model finalizer</label>
      <select id={id} className="glass-input rounded-xl p-3" value={value.finalModel} onChange={(event) => onChange({ ...value, finalModel: event.target.value })}>
        <option value="">Pilih model</option>
        {catalog.filter((model) => model.available).map((model) => <option key={model.id} value={model.id}>{model.displayName} — {model.providerName}</option>)}
      </select>
      <p className="text-xs text-[var(--muted)]">Model yang dipilih bisa berasal dari provider berbeda. Pesan dan lampiran yang diteruskan akan diproses oleh provider tersebut.</p>
    </fieldset>
  );
}

export function PanelTranscript({ result, catalog }: { result: PanelResult; catalog: PanelModel[] }) {
  const name = (id: string) => {
    const model = catalog.find((item) => item.id === id);
    return model ? `${model.displayName} · ${model.providerName}` : id;
  };
  const renderEntries = (entries: Entry[]) => entries.map((entry) => (
    <article key={entry.model} className="glass-card space-y-2 rounded-xl p-3">
      <h4 className="break-words text-sm font-semibold">{name(entry.model)}</h4>
      <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
      <p className="text-xs text-[var(--muted)]">{entry.usage ? `${entry.usage.total.toLocaleString('id-ID')} token` : 'Usage tidak tersedia'}</p>
    </article>
  ));
  return (
    <section aria-label="Hasil Panel Diskusi" className="glass-panel space-y-4 p-4">
      <h3 className="font-semibold text-[var(--accent)]">Jawaban final</h3>
      {renderEntries([result.final])}
      <details><summary className="cursor-pointer py-2">Pendapat awal ({result.opinions.length})</summary><div className="space-y-2">{renderEntries(result.opinions)}</div></details>
      <details><summary className="cursor-pointer py-2">Tanggapan diskusi ({result.discussion.length})</summary><div className="space-y-2">{renderEntries(result.discussion)}</div></details>
    </section>
  );
}
