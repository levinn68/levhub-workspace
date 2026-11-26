'use client';

export type ActivityStep = {
  id: string;
  label: string;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  summary?: string;
};

const labels: Record<ActivityStep['status'], string> = {
  waiting: 'Menunggu', running: 'Berjalan', done: 'Selesai', failed: 'Gagal', cancelled: 'Dibatalkan',
};

/** Shows real workflow steps supplied by the caller, not invented model reasoning. */
export function AnswerActivity({ steps }: { steps: readonly ActivityStep[] }) {
  if (!steps.length) return null;
  const running = steps.filter(({ status }) => status === 'running');
  const done = steps.filter(({ status }) => status === 'done').length;
  return <details className="chat-activity">
    <summary>Proses jawaban <span>{done}/{steps.length} selesai</span></summary>
    <p className="chat-activity-live" role="status">{running.length ? running.map(({ label }) => label).join(' · ') : 'Tidak ada tahap yang sedang berjalan'}</p>
    <ol>{steps.map((step) => <li key={step.id} data-status={step.status}>
      <details><summary>{step.label} · {labels[step.status]}</summary><p>{step.summary || 'Belum ada detail untuk tahap ini.'}</p></details>
    </li>)}</ol>
  </details>;
}
