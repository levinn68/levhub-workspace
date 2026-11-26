'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ChatTranscript, type ChatMessage, type ToolCard } from '@/components/ChatTranscript';
import { ChatComposer, type Attachment } from '@/components/ChatComposer';
import { apiFetch, streamChatRequest } from '@/lib/api';

type ModelItem = { id: string; displayName: string; provider?: string; available: boolean };

function ChatWorkspaceInner() {
  const params = useSearchParams();
  const initialId = params.get('id') || undefined;
  const [conversationId, setConversationId] = useState(initialId);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [model, setModel] = useState('');
  const [modelsError, setModelsError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const loadModels = useCallback(async () => {
    setModelsError('');
    try {
      const data = await apiFetch<{ items: ModelItem[] }>('/api/models');
      setModels(data.items);
      setModel((current) => current || data.items.find((item) => item.available)?.id || '');
    } catch (err) { setModelsError(err instanceof Error ? err.message : 'Katalog model gagal dimuat.'); }
  }, []);
  useEffect(() => { void loadModels(); }, [loadModels]);

  useEffect(() => {
    if (!initialId) return;
    setConversationId(initialId);
    apiFetch<{
      conversation: { model_id: string | null };
      messages: Array<{ id: string; role: ChatMessage['role']; content: { text?: string }; created_at: string }>;
      toolCalls: Array<{ id: string; tool_name: string; source: string; status: string; arguments_redacted: Record<string, unknown>; result_summary: string | null }>;
    }>(`/api/conversations/${initialId}`).then((data) => {
      if (data.conversation.model_id) setModel(data.conversation.model_id);
      setMessages(data.messages.map(({ id, role, content, created_at }) => ({ id, role, text: typeof content?.text === 'string' ? content.text : JSON.stringify(content), createdAt: created_at })));
      setTools(data.toolCalls.map((tool) => ({ toolCallId: tool.id, toolName: tool.tool_name, source: tool.source, status: tool.status, argumentsRedacted: tool.arguments_redacted, summary: tool.result_summary || undefined })));
    }).catch((err) => setError(err instanceof Error ? err.message : 'Percakapan gagal dimuat.'));
  }, [initialId]);

  async function send() {
    if (streaming || !model) return;
    const text = draft;
    const files = attachments;
    const assistantId = `pending-${Date.now()}`;
    setError(''); setStreaming(true); setDraft(''); setAttachments([]);
    setMessages((previous) => [...previous, { id: `user-${Date.now()}`, role: 'user', text, attachments: files.map(({ name, mimeType }) => ({ name, mimeType })) }, { id: assistantId, role: 'assistant', text: '' }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChatRequest({ conversationId, modelId: model, message: text, attachments: files }, (event) => {
        if (event.conversationId) setConversationId((current) => current || event.conversationId);
        const payload = event.payload ?? {};
        if (event.type === 'message.delta' && typeof payload.delta === 'string') {
          setMessages((previous) => previous.map((item) => item.id === assistantId ? { ...item, text: item.text + payload.delta } : item));
        } else if (event.type === 'approval.required') {
          setTools((previous) => [...previous, { toolCallId: String(payload.toolCallId), toolName: String(payload.toolName), source: String(payload.source), status: 'pending_approval', argumentsRedacted: payload.argumentsRedacted as Record<string, unknown>, reason: String(payload.reason || '') }]);
        } else if (event.type === 'tool.started') {
          setTools((previous) => [...previous, { toolCallId: String(payload.toolCallId), toolName: String(payload.toolName), source: String(payload.source), status: 'running' }]);
        } else if (event.type === 'tool.completed') {
          setTools((previous) => previous.map((tool) => tool.toolCallId === payload.toolCallId ? { ...tool, status: 'succeeded', summary: String(payload.summary || '') } : tool));
        } else if (event.type === 'tool.failed') {
          setTools((previous) => previous.map((tool) => tool.toolCallId === payload.toolCallId ? { ...tool, status: 'failed' } : tool));
        } else if (event.type === 'turn.error') {
          setError(event.error?.message || String(payload.message || 'Router gagal menjawab.'));
        }
      }, controller.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Pesan gagal dikirim.');
        setDraft(text);
        setAttachments(files);
        setMessages((previous) => previous.filter((item) => item.id !== assistantId));
      }
    } finally {
      setStreaming(false);
      abort.current = null;
    }
  }

  async function decide(toolCallId: string, approved: boolean) {
    try {
      const result = await apiFetch<{ status: string; summary: string }>(`/api/chat/tool-calls/${toolCallId}/decision`, { method: 'POST', body: JSON.stringify({ approved }) });
      setTools((previous) => previous.map((tool) => tool.toolCallId === toolCallId ? { ...tool, status: result.status, summary: result.summary } : tool));
    } catch (err) { setError(err instanceof Error ? err.message : 'Keputusan tool gagal diproses.'); }
  }

  const activeModel = models.find((item) => item.id === model);
  const selector = <select aria-label="Pilih model" value={model} disabled={!models.length} onChange={(event) => setModel(event.target.value)} className="glass-input max-w-full rounded-lg px-2 py-2 text-sm">
    {!models.length && <option value="">{modelsError ? 'Model tidak tersedia' : 'Memuat model…'}</option>}
    {models.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.displayName}{item.provider ? ` · ${item.provider}` : ''}</option>)}
  </select>;

  return <AppShell title="Chat" topBarExtra={selector}><div className="chat-shell">
    {modelsError && <div className="chat-tool" data-status="failed"><p>{modelsError}</p><button type="button" className="chat-allow" onClick={() => void loadModels()}>Muat ulang model</button></div>}
    <ChatTranscript messages={messages} tools={tools} streaming={streaming} onDecide={decide} />
    {error && <p role="alert" className="chat-tool" data-status="failed">{error}</p>}
    <ChatComposer value={draft} onChange={setDraft} onSubmit={() => void send()} disabled={!model} streaming={streaming} onStop={() => abort.current?.abort()} attachments={attachments} onAttachmentsChange={setAttachments} modelHint={activeModel ? `${activeModel.displayName}${activeModel.provider ? ` · ${activeModel.provider}` : ''}` : undefined} />
  </div></AppShell>;
}

export default function ChatPage() {
  return <Suspense fallback={<div className="workspace-gate"><p>Memuat chat…</p></div>}><ChatWorkspaceInner /></Suspense>;
}
