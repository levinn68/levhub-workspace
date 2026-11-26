'use client';

import { SafeMarkdown } from './SafeMarkdown';
import { AnswerActivity, type ActivityStep } from './AnswerActivity';

export type ChatMessage = { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; text: string; createdAt?: string; attachments?: Array<{ name: string; mimeType: string }> };
export type ToolCard = { toolCallId: string; toolName: string; source: string; status: string; argumentsRedacted?: Record<string, unknown>; reason?: string; summary?: string };

const statusLabel = (status: string) => ({ pending_approval: 'Butuh persetujuan', running: 'Berjalan', succeeded: 'Selesai', failed: 'Gagal', denied: 'Ditolak' } as Record<string, string>)[status] ?? status;
const stepStatus = (status: string): ActivityStep['status'] => status === 'pending_approval' ? 'waiting' : status === 'running' ? 'running' : status === 'succeeded' ? 'done' : status === 'denied' ? 'cancelled' : 'failed';

export function ChatTranscript({ messages, tools, streaming, onDecide }: {
  messages: ChatMessage[];
  tools: ToolCard[];
  streaming: boolean;
  onDecide: (id: string, approved: boolean) => void;
}) {
  if (!messages.length && !tools.length) return <div className="chat-empty">
    <h1>Mulai percakapan</h1>
    <p>Pilih model di atas, lalu tulis pesan atau lampirkan file.</p>
  </div>;

  const steps: ActivityStep[] = tools.map((tool) => ({ id: tool.toolCallId, label: tool.toolName, status: stepStatus(tool.status), summary: tool.summary }));
  if (streaming) steps.push({ id: 'streaming', label: 'Menyusun jawaban', status: 'running' });

  return <div className="chat-transcript" aria-live="polite">
    {steps.length > 0 && <AnswerActivity steps={steps} />}
    {messages.map((message) => <article key={message.id} className="chat-turn" data-role={message.role}>
      <p className="chat-author">{message.role === 'user' ? 'Anda' : message.role === 'assistant' ? 'LEVHUB' : message.role}</p>
      {message.text ? <SafeMarkdown content={message.text} /> : <p className="chat-pending">{streaming ? 'Sedang menulis…' : 'Tidak ada teks.'}</p>}
      {message.attachments?.length ? <ul className="chat-file-list">{message.attachments.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}</li>)}</ul> : null}
    </article>)}
    {tools.map((tool) => <section key={tool.toolCallId} className="chat-tool" data-status={tool.status}>
      <header><strong>{tool.toolName}</strong><span>{tool.source} · {statusLabel(tool.status)}</span></header>
      {tool.summary && <p className="break-words">{tool.summary}</p>}
      {tool.argumentsRedacted && <details><summary>Argumen (teredaksi)</summary><pre>{JSON.stringify(tool.argumentsRedacted, null, 2)}</pre></details>}
      {tool.status === 'pending_approval' && <div className="chat-approval"><p>{tool.reason || 'Aksi ini memerlukan persetujuan.'}</p><div><button type="button" className="chat-deny" onClick={() => onDecide(tool.toolCallId, false)}>Tolak</button><button type="button" className="chat-allow" onClick={() => onDecide(tool.toolCallId, true)}>Setujui & jalankan</button></div></div>}
    </section>)}
  </div>;
}
