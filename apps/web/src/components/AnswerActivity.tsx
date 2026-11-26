'use client';

export type ActivityStep = {
  id: string;
  label: string;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  summary?: string;
};

const labels: Record<ActivityStep['status'], string> = {
  waiting: 'Menunggu', running: 'Sedang berjalan', done: 'Selesai', failed: 'Gagal', cancelled: 'Dibatalkan',
};

/** Render actual workflow events and public artifacts, not private model reasoning. */
export function AnswerActivity({ steps }: { steps: readonly ActivityStep[] }) {
  if (!steps.length) return null;
  const active = steps.filter(({ status }) => status === 'running');
  const finished = steps.filter(({ status }) => status === 'done').length;
  return (
    <details className="glass-card rounded-2xl px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Proses jawaban <span className="font-normal text-[var(--muted)]">· {finished}/{steps.length} selesai</span>
      </summary>
      <p role="status" className="mt-2 text-xs text-[var(--muted)]">
        {active.length ? active.map(({ label }) => label).join(' · ') : 'Tidak ada tahap yang sedang berjalan'}
      </p>
      <ol className="mt-3 space-y-2 border-l border-[var(--line)] pl-3">
        {steps.map((step) => (
          <li key={step.id} className="glass-card rounded-xl p-3 text-sm">
            <details>
              <summary className="cursor-pointer break-words"><span className="font-medium">{step.label}</span> <span className={step.status === 'running' ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}>· {labels[step.status]}</span></summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{step.summary || 'Belum ada detail untuk tahap ini.'}</p>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
