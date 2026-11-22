'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Send,
  Square,
  RefreshCw,
  Wrench,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { SafeMarkdown } from '@/components/SafeMarkdown';
import { apiFetch, streamChatRequest } from '@/lib/api';

interface ModelItem {
  id: string;
  displayName: string;
  provider?: string;
  available: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt?: string;
}

interface ToolActivity {
  toolCallId: string;
  toolName: string;
  source: string;
  status: string;
  argumentsRedacted?: Record<string, unknown>;
  reason?: string;
  riskLevel?: string;
  summary?: string;
}

function ChatWorkspaceInner() {
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get('id') || undefined;

  const [conversationId, setConversationId] = useState<string | undefined>(initialConvId);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    apiFetch<{ items: ModelItem[] }>('/api/models')
      .then((res) => {
        setModels(res.items);
        const firstAvailable = res.items.find((m) => m.available);
        if (firstAvailable && !selectedModel) {
          setSelectedModel(firstAvailable.id);
        }
      })
      .catch((err) => {
        setModelsError(err instanceof Error ? err.message : 'Gagal memuat katalog model dari Router.');
      });
  }, [selectedModel]);

  useEffect(() => {
    if (!initialConvId) return;
    setConversationId(initialConvId);
    apiFetch<{
      conversation: { id: string; model_id: string | null };
      messages: Array<{ id: string; role: ChatMessage['role']; content: { text?: string }; created_at: string }>;
      toolCalls: Array<{
        id: string;
        tool_name: string;
        source: string;
        status: string;
        arguments_redacted: Record<string, unknown>;
        result_summary: string | null;
      }>;
    }>(`/api/conversations/${initialConvId}`)
      .then((data) => {
        if (data.conversation.model_id) setSelectedModel(data.conversation.model_id);
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: typeof m.content?.text === 'string' ? m.content.text : JSON.stringify(m.content),
            createdAt: m.created_at,
          })),
        );
        setToolActivities(
          data.toolCalls.map((tc) => ({
            toolCallId: tc.id,
            toolName: tc.tool_name,
            source: tc.source,
            status: tc.status,
            argumentsRedacted: tc.arguments_redacted,
            summary: tc.result_summary || undefined,
          })),
        );
      })
      .catch(() => {});
  }, [initialConvId]);

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const text = draft.trim();
    if (!text || !selectedModel || isStreaming) return;

    setTurnError(null);
    setIsStreaming(true);

    const tempUserId = `user-${Date.now()}`;
    const tempAssistantId = `asst-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: 'user', text },
      { id: tempAssistantId, role: 'assistant', text: '' },
    ]);
    setDraft('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChatRequest(
        { conversationId, modelId: selectedModel, message: text },
        (ev) => {
          if (ev.conversationId && !conversationId) {
            setConversationId(ev.conversationId);
          }

          if (ev.type === 'message.delta' && typeof ev.payload?.delta === 'string') {
            const delta = ev.payload.delta;
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, text: m.text + delta } : m)),
            );
          } else if (ev.type === 'approval.required' && ev.payload) {
            setToolActivities((prev) => [
              ...prev,
              {
                toolCallId: String(ev.payload!.toolCallId),
                toolName: String(ev.payload!.toolName),
                source: String(ev.payload!.source),
                status: 'pending_approval',
                argumentsRedacted: (ev.payload!.argumentsRedacted as Record<string, unknown>) || {},
                reason: String(ev.payload!.reason || ''),
                riskLevel: String(ev.payload!.riskLevel || 'high'),
              },
            ]);
          } else if (ev.type === 'tool.started' && ev.payload) {
            setToolActivities((prev) => [
              ...prev,
              {
                toolCallId: String(ev.payload!.toolCallId),
                toolName: String(ev.payload!.toolName),
                source: String(ev.payload!.source),
                status: 'running',
              },
            ]);
          } else if (ev.type === 'tool.completed' && ev.payload) {
            const id = String(ev.payload.toolCallId);
            setToolActivities((prev) =>
              prev.map((t) =>
                t.toolCallId === id ? { ...t, status: 'succeeded', summary: String(ev.payload!.summary || '') } : t,
              ),
            );
          } else if (ev.type === 'tool.failed' && ev.payload) {
            const id = String(ev.payload.toolCallId || '');
            setToolActivities((prev) =>
              prev.map((t) => (t.toolCallId === id ? { ...t, status: 'failed' } : t)),
            );
          } else if (ev.type === 'turn.error') {
            setTurnError(ev.error?.message || String(ev.payload?.message || 'Terjadi gangguan pada Router.'));
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setTurnError(err instanceof Error ? err.message : 'Gagal mengirim pesan.');
        setDraft(text); // Preserve draft on recoverable error (UX Section 5)
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  async function handleToolDecision(toolCallId: string, approved: boolean) {
    try {
      const res = await apiFetch<{ status: string; summary: string }>(
        `/api/chat/tool-calls/${toolCallId}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({ approved }),
        },
      );
      setToolActivities((prev) =>
        prev.map((t) => (t.toolCallId === toolCallId ? { ...t, status: res.status, summary: res.summary } : t)),
      );
    } catch (err) {
      setTurnError(err instanceof Error ? err.message : 'Gagal memproses keputusan tool.');
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsStreaming(false);
  }

  const topBarModelSelect = (
    <div className="flex items-center gap-2">
      <label htmlFor="chat-model-select" className="sr-only">
        Pilih Model AI
      </label>
      <select
        id="chat-model-select"
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        className="glass-input max-w-[220px] truncate rounded-xl px-3 py-1.5 text-xs text-slate-100"
      >
        {models.length === 0 && <option value="">Memuat model...</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.available} className="bg-slate-900">
            {m.displayName} {!m.available ? '(Tidak tersedia)' : ''}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <AppShell title="LEVHUB Chat" topBarExtra={topBarModelSelect}>
      <div className="flex flex-1 flex-col gap-4">
        {modelsError && (
          <div className="glass-card flex items-center justify-between gap-3 rounded-2xl border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {modelsError}
            </span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1 font-medium hover:bg-amber-500/30"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Muat Ulang
            </button>
          </div>
        )}

        {/* Messages Stream */}
        <div className="glass-panel flex-1 space-y-4 overflow-y-auto rounded-3xl p-4 md:p-6">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/30">
                <Wrench className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-white">Ruang Kendali LEVHUB Siap</h2>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                Pilih model aktif di kanan atas, lalu mulai percakapan. Tool MCP dan Skills yang aktif akan otomatis
                tersedia dengan proteksi approval.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-sky-500/20 text-sky-50 ring-1 ring-sky-400/30'
                      : 'glass-card text-slate-100'
                  }`}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {msg.role === 'user' ? 'Anda' : 'LEVHUB'}
                  </p>
                  {msg.text ? (
                    <SafeMarkdown content={msg.text} />
                  ) : (
                    <span className="text-xs italic text-slate-400">Sedang menghasilkan respons...</span>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Tool Activity & Server-Side Approval Cards */}
          {toolActivities.map((tc) => (
            <div
              key={tc.toolCallId}
              className="glass-card rounded-2xl border-indigo-400/25 p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-indigo-200">
                  <Wrench className="h-4 w-4" />
                  <span>{tc.toolName}</span>
                  <span className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{tc.source}</span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px]">
                  {tc.status === 'succeeded' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                  {tc.status === 'denied' && <XCircle className="h-3.5 w-3.5 text-rose-400" />}
                  {tc.status === 'pending_approval' && <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />}
                  {tc.status}
                </span>
              </div>

              {tc.argumentsRedacted && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] text-slate-300">
                  {JSON.stringify(tc.argumentsRedacted, null, 2)}
                </pre>
              )}

              {tc.summary && <p className="mt-2 text-slate-300">{tc.summary}</p>}

              {tc.status === 'pending_approval' && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                  <p className="text-amber-200">{tc.reason || 'Aksi ini memerlukan persetujuan eksplisit Anda.'}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToolDecision(tc.toolCallId, false)}
                      className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 font-medium text-rose-200 hover:bg-rose-500/25"
                    >
                      Tolak
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToolDecision(tc.toolCallId, true)}
                      className="rounded-lg bg-emerald-400 px-3 py-1.5 font-semibold text-slate-950 hover:brightness-110"
                    >
                      Setujui & Jalankan
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {turnError && (
          <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
            {turnError}
          </div>
        )}

        {/* Composer */}
        <form onSubmit={handleSend} className="glass-panel flex items-end gap-2 rounded-2xl p-3">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Tulis pesan ke LEVHUB... (Enter kirim, Shift+Enter baris baru)"
            className="glass-input max-h-40 flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Hentikan generasi"
              className="flex h-11 items-center gap-1.5 rounded-xl bg-rose-500/80 px-4 text-xs font-semibold text-white hover:bg-rose-500"
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || !selectedModel}
              aria-label="Kirim pesan"
              className="flex h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-400 px-4 text-xs font-semibold text-slate-950 shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              Kirim
            </button>
          )}
        </form>
      </div>
    </AppShell>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-400">Memuat ruang chat...</div>}>
      <ChatWorkspaceInner />
    </Suspense>
  );
}
