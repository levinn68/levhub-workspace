'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
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
  Paperclip,
  X,
  Users,
  FileText,
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

interface AttachmentMeta {
  path: string;
  name: string;
  mimeType: string;
  size: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  createdAt?: string;
  attachments?: Array<{ name: string; mimeType: string }>;
  collaboration?: Array<{ role: string; modelName: string }>;
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

/** Signed upload target returned by POST /api/chat/attachments/sign. */
interface SignedUpload {
  signedUrl: string;
  token?: string;
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

const MAX_ATTACHMENTS = 8;
const DISPLAY_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.zip';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function ChatWorkspaceInner() {
  const searchParams = useSearchParams();
  const initialConvId = searchParams.get('id') || undefined;

  const [conversationId, setConversationId] = useState<string | undefined>(initialConvId);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentMeta[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [collaborationMode, setCollaborationMode] = useState(false);
  const [collaboratorModel, setCollaboratorModel] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Root cause fixed here: this effect previously depended on [selectedModel],
   * so every model change refetched the catalogue, and the fetch itself called
   * setSelectedModel() — re-triggering the effect (request storm / render loop).
   * It now runs once on mount and uses functional updates, plus a manual reload
   * action for the error state.
   */
  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await apiFetch<{ items: ModelItem[] }>('/api/models');
      setModels(res.items);
      const available = res.items.filter((m) => m.available);
      setSelectedModel((current) => current || available[0]?.id || '');
      setCollaboratorModel((current) => current || available[1]?.id || available[0]?.id || '');
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Gagal memuat katalog model dari Router.');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

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
    // Attachment-only messages are valid: the API accepts an empty message when
    // files are present, so the UI no longer injects a fake prompt.
    if ((!text && pendingAttachments.length === 0) || !selectedModel || isStreaming || uploadingFiles) return;

    setTurnError(null);
    setIsStreaming(true);

    const tempUserId = `user-${Date.now()}`;
    const tempAssistantId = `asst-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: 'user', text, attachments: pendingAttachments.map(({ name, mimeType }) => ({ name, mimeType })) },
      { id: tempAssistantId, role: 'assistant', text: '' },
    ]);
    setDraft('');
    const attachmentsToSend = pendingAttachments;
    setPendingAttachments([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (collaborationMode) {
        const secondModel = collaboratorModel && collaboratorModel !== selectedModel
          ? collaboratorModel
          : models.find((m) => m.available && m.id !== selectedModel)?.id;
        if (!secondModel) throw new Error('Pilih minimal dua model AI yang tersedia untuk kolaborasi.');
        const result = await apiFetch<{ conversationId: string; steps: Array<{ role: string; modelName: string }>; finalText: string }>('/api/chat/collaborate', {
          method: 'POST',
          body: JSON.stringify({ conversationId, modelIds: [selectedModel, secondModel], message: text, attachments: attachmentsToSend }),
        });
        setConversationId(result.conversationId);
        setMessages((prev) => prev.map((m) => m.id === tempAssistantId
          ? { ...m, text: result.finalText, collaboration: result.steps.map(({ role, modelName }) => ({ role, modelName })) }
          : m));
        return;
      }
      await streamChatRequest(
        { conversationId, modelId: selectedModel, message: text, attachments: attachmentsToSend },
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
        setPendingAttachments(attachmentsToSend); // Do not lose uploaded files
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  /**
   * Uploads files to private Supabase Storage using the signed upload URL.
   * Supabase's signed upload endpoint expects a PUT of raw bytes with the
   * `x-upsert` header and the upload token as Authorization when provided.
   * Each file reports its own progress; failures do not abort the whole batch.
   */
  async function uploadOneFile(file: File, index: number, total: number): Promise<AttachmentMeta | null> {
    const mimeType = file.type || 'application/octet-stream';
    setUploadProgress(`Mengunggah ${index + 1}/${total}: ${file.name}`);

    const signed = await apiFetch<SignedUpload>('/api/chat/attachments/sign', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, mimeType, size: file.size }),
    });

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'x-upsert': 'false',
    };
    if (signed.token) headers.Authorization = `Bearer ${signed.token}`;

    const response = await fetch(signed.signedUrl, { method: 'PUT', headers, body: file });
    if (!response.ok) {
      throw new Error(`Upload ${file.name} gagal (HTTP ${response.status}).`);
    }
    return { path: signed.path, name: file.name, mimeType, size: file.size };
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const room = MAX_ATTACHMENTS - pendingAttachments.length;
    if (room <= 0) {
      setTurnError(`Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`);
      return;
    }
    const accepted = files.slice(0, room);
    const skipped = files.length - accepted.length;

    setUploadingFiles(true);
    setTurnError(skipped > 0 ? `${skipped} file dilewati karena batas ${MAX_ATTACHMENTS} lampiran.` : null);

    const uploaded: AttachmentMeta[] = [];
    const failures: string[] = [];
    try {
      for (let i = 0; i < accepted.length; i++) {
        try {
          const result = await uploadOneFile(accepted[i], i, accepted.length);
          if (result) uploaded.push(result);
        } catch (err) {
          failures.push(err instanceof Error ? err.message : `Gagal mengunggah ${accepted[i].name}.`);
        }
      }
      if (uploaded.length > 0) setPendingAttachments((prev) => [...prev, ...uploaded].slice(0, MAX_ATTACHMENTS));
      if (failures.length > 0) setTurnError(failures.join(' '));
    } finally {
      setUploadProgress('');
      setUploadingFiles(false);
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
        {modelsLoading && <option value="">Memuat model...</option>}
        {!modelsLoading && models.length === 0 && <option value="">Tidak ada model tersedia</option>}
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
              onClick={() => void loadModels()}
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
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.attachments.map((file, index) => (
                        <span key={index} className="inline-flex items-center gap-1 rounded-lg bg-black/20 px-2 py-1 text-[10px] text-slate-300">
                          <FileText className="h-3 w-3" /> {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.collaboration && msg.collaboration.length > 0 && (
                    <div className="mt-3 rounded-xl border border-indigo-300/20 bg-indigo-400/10 p-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200"><Users className="h-3.5 w-3.5" /> Tim AI berkolaborasi</div>
                      {msg.collaboration.map((agent, index) => <p key={index} className="text-[10px] text-slate-300">{agent.role}: {agent.modelName}</p>)}
                    </div>
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
        <div className="glass-panel rounded-2xl p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={DISPLAY_ACCEPT}
              className="hidden"
              onChange={handleFilesSelected}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFiles || isStreaming || pendingAttachments.length >= MAX_ATTACHMENTS}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
            >
              <Paperclip className="h-3.5 w-3.5" /> {uploadingFiles ? 'Mengunggah...' : 'Lampirkan file'}
            </button>
            <button type="button" onClick={() => setCollaborationMode((v) => !v)} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs ${collaborationMode ? 'border-indigo-300/40 bg-indigo-400/20 text-indigo-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
              <Users className="h-3.5 w-3.5" /> {collaborationMode ? 'Kolaborasi AI aktif' : 'Kolaborasi AI'}
            </button>
            {collaborationMode && (
              <select value={collaboratorModel} onChange={(e) => setCollaboratorModel(e.target.value)} className="glass-input min-w-0 flex-1 rounded-lg px-2 py-2 text-[11px] text-slate-100">
                <option value="">Pilih AI kedua</option>
                {models.filter((m) => m.available && m.id !== selectedModel).map((m) => <option key={m.id} value={m.id} className="bg-slate-900">{m.displayName}</option>)}
              </select>
            )}
            <span className="ml-auto text-[10px] text-slate-500">
              {pendingAttachments.length}/{MAX_ATTACHMENTS} lampiran
            </span>
          </div>

          {uploadProgress && (
            <p className="mb-2 text-[10px] text-sky-200" aria-live="polite">{uploadProgress}</p>
          )}

          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map((file) => {
                const isImage = file.mimeType.startsWith('image/');
                return (
                  <span key={file.path} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-sky-300/20 bg-sky-400/10 px-2.5 py-1.5 text-[10px] text-sky-100">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="max-w-[160px] truncate">{file.name}</span>
                    <span className="shrink-0 text-[9px] text-sky-300/70">{formatBytes(file.size)}</span>
                    {isImage && <span className="shrink-0 rounded bg-sky-300/20 px-1 text-[9px]">IMG</span>}
                    <button
                      type="button"
                      aria-label={`Hapus ${file.name}`}
                      onClick={() => setPendingAttachments((prev) => prev.filter((item) => item.path !== file.path))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <form onSubmit={handleSend} className="flex items-end gap-2">
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
              disabled={(!draft.trim() && pendingAttachments.length === 0) || !selectedModel || uploadingFiles}
              aria-label="Kirim pesan"
              className="flex h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-400 px-4 text-xs font-semibold text-slate-950 shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              Kirim
            </button>
          )}
          </form>
        </div>
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
