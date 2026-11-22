import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { LevhubModel, ToolSchema } from '../types.js';
import { LevhubError } from '../security/errors.js';

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | Array<Record<string, unknown>>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  tools?: ToolSchema[];
  stream?: boolean;
  signal?: AbortSignal;
}

export class RouterAdapter {
  private cache: { items: LevhubModel[]; fetchedAt: string; expiresAt: number } | null = null;
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.ROUTER_BASE_URL.replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.ROUTER_API_KEY) {
      h.Authorization = `Bearer ${this.config.ROUTER_API_KEY}`;
    }
    return h;
  }

  normalizeError(status: number, correlationId = crypto.randomUUID()): LevhubError {
    if (status === 401 || status === 403) {
      return new LevhubError(
        'UPSTREAM_AUTH_FAILED',
        'Autentikasi ke Router API ditolak. Periksa ROUTER_API_KEY di konfigurasi server.',
        502,
        false,
        correlationId,
      );
    }
    if (status === 429) {
      return new LevhubError(
        'RATE_LIMITED',
        'Router API mencapai batas permintaan (rate limit). Coba lagi beberapa saat.',
        429,
        true,
        correlationId,
      );
    }
    return new LevhubError(
      'UPSTREAM_UNAVAILABLE',
      `Router API mengembalikan status ${status}.`,
      502,
      status >= 500,
      correlationId,
    );
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string; endpoint: string }> {
    const started = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          message: `HTTP ${res.status}`,
          endpoint: this.baseUrl,
        };
      }
      return {
        ok: true,
        latencyMs: Date.now() - started,
        message: 'Terhubung',
        endpoint: this.baseUrl,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Router tidak terjangkau',
        endpoint: this.baseUrl,
      };
    }
  }

  /**
   * Live model discovery from Router API with short TTL cache and zero hardcoded models (FR-MOD-001).
   */
  async listModels(forceRefresh = false): Promise<{ items: LevhubModel[]; fetchedAt: string; stale: boolean }> {
    const now = Date.now();
    if (!forceRefresh && this.cache && now < this.cache.expiresAt) {
      return { items: this.cache.items, fetchedAt: this.cache.fetchedAt, stale: false };
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/models`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(this.config.ROUTER_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw this.normalizeError(res.status);
        }

        const json = (await res.json()) as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> };
        const rawList = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : null;
        if (!rawList) {
          throw new LevhubError('UPSTREAM_UNAVAILABLE', 'Format respons katalog model Router tidak valid.', 502, true);
        }

        const items: LevhubModel[] = rawList
          .filter((entry) => typeof entry?.id === 'string' && entry.id.trim().length > 0)
          .map((entry) => {
            const id = String(entry.id);
            const provider =
              typeof entry.owned_by === 'string'
                ? entry.owned_by
                : typeof entry.provider === 'string'
                  ? entry.provider
                  : undefined;
            const caps = typeof entry.capabilities === 'object' && entry.capabilities !== null
              ? (entry.capabilities as Record<string, unknown>)
              : undefined;
            return {
              id,
              displayName: typeof entry.name === 'string' && entry.name ? entry.name : id,
              provider,
              capabilities: caps
                ? {
                    streaming: typeof caps.streaming === 'boolean' ? caps.streaming : undefined,
                    tools: typeof caps.tools === 'boolean' ? caps.tools : undefined,
                    vision: typeof caps.vision === 'boolean' ? caps.vision : undefined,
                    contextLength: typeof caps.context_length === 'number' ? caps.context_length : undefined,
                  }
                : undefined,
              available: entry.available !== false,
              rawMetadata: entry,
            };
          });

        const fetchedAt = new Date().toISOString();
        this.cache = { items, fetchedAt, expiresAt: now + this.config.ROUTER_CATALOG_TTL_MS };
        return { items, fetchedAt, stale: false };
      } catch (err) {
        lastError = err;
        if (err instanceof LevhubError && !err.retryable) break;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1) + Math.floor(Math.random() * 150)));
      }
    }

    if (this.cache) {
      return { items: this.cache.items, fetchedAt: this.cache.fetchedAt, stale: true };
    }
    if (lastError instanceof LevhubError) throw lastError;
    throw new LevhubError('UPSTREAM_UNAVAILABLE', 'Router API tidak dapat dijangkau saat ini.', 502, true);
  }

  private buildPayload(req: ChatCompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: Boolean(req.stream),
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }
    return body;
  }

  async createChatCompletion(req: ChatCompletionRequest): Promise<{
    content: string;
    toolCalls: Array<{ id: string; name: string; argumentsRaw: string }>;
  }> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildPayload({ ...req, stream: false })),
      signal: req.signal ?? AbortSignal.timeout(this.config.ROUTER_TIMEOUT_MS),
    });

    if (!res.ok) throw this.normalizeError(res.status);

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };

    const msg = data.choices?.[0]?.message;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const toolCalls = (msg?.tool_calls ?? [])
      .filter((tc) => typeof tc.function?.name === 'string')
      .map((tc) => ({
        id: tc.id || crypto.randomUUID(),
        name: String(tc.function!.name),
        argumentsRaw: typeof tc.function?.arguments === 'string' ? tc.function.arguments : '{}',
      }));

    return { content, toolCalls };
  }

  async *streamChatCompletion(
    req: ChatCompletionRequest,
  ): AsyncGenerator<
    | { kind: 'delta'; text: string }
    | { kind: 'tool_calls'; calls: Array<{ id: string; name: string; argumentsRaw: string }> }
  > {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildPayload({ ...req, stream: true })),
      signal: req.signal ?? AbortSignal.timeout(this.config.ROUTER_TIMEOUT_MS),
    });

    if (!res.ok) throw this.normalizeError(res.status);
    if (!res.body) {
      const fallback = await this.createChatCompletion({ ...req, stream: false });
      if (fallback.content) yield { kind: 'delta', text: fallback.content };
      if (fallback.toolCalls.length > 0) yield { kind: 'tool_calls', calls: fallback.toolCalls };
      return;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
      };
      const msg = data.choices?.[0]?.message;
      if (typeof msg?.content === 'string' && msg.content) {
        yield { kind: 'delta', text: msg.content };
      }
      if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
        yield {
          kind: 'tool_calls',
          calls: msg.tool_calls
            .filter((tc) => tc.function?.name)
            .map((tc) => ({
              id: tc.id || crypto.randomUUID(),
              name: String(tc.function!.name),
              argumentsRaw: tc.function?.arguments || '{}',
            })),
        };
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolAcc = new Map<number, { id: string; name: string; argumentsRaw: string }>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (payload === '[DONE]') continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }

        const choices = parsed.choices as Array<{ delta?: Record<string, unknown> }> | undefined;
        const delta = choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { kind: 'delta', text: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const part of delta.tool_calls as Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>) {
            const idx = part.index ?? 0;
            const current = toolAcc.get(idx) ?? {
              id: part.id || crypto.randomUUID(),
              name: '',
              argumentsRaw: '',
            };
            if (part.id) current.id = part.id;
            if (part.function?.name) current.name += part.function.name;
            if (part.function?.arguments) current.argumentsRaw += part.function.arguments;
            toolAcc.set(idx, current);
          }
        }
      }
    }

    if (toolAcc.size > 0) {
      yield {
        kind: 'tool_calls',
        calls: Array.from(toolAcc.values()).filter((c) => c.name.length > 0),
      };
    }
  }
}
