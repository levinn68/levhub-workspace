export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlationId: string;
  };
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly correlationId = '',
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method || 'GET').toUpperCase();

  if (!(init.body instanceof FormData) && init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const csrf = readCookie('levhub_csrf');
    if (csrf) headers.set('x-levhub-csrf', csrf);
  }

  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    let payload: ApiErrorPayload | null = null;
    try {
      payload = (await res.json()) as ApiErrorPayload;
    } catch {
      payload = null;
    }
    throw new ApiClientError(
      payload?.error?.code || 'INTERNAL_ERROR',
      payload?.error?.message || `Permintaan gagal (HTTP ${res.status}).`,
      res.status,
      Boolean(payload?.error?.retryable),
      payload?.error?.correlationId || '',
    );
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export interface StreamEvent {
  type: string;
  correlationId?: string;
  conversationId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
  error?: ApiErrorPayload['error'];
}

export async function streamChatRequest(
  body: { conversationId?: string; modelId: string; message: string; attachments?: Array<{ path: string; name: string; mimeType: string; size: number }> },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrf = readCookie('levhub_csrf');
  if (csrf) headers['x-levhub-csrf'] = csrf;

  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `Gagal memulai chat (HTTP ${res.status}).`;
    try {
      const err = (await res.json()) as ApiErrorPayload;
      if (err?.error?.message) msg = err.error.message;
    } catch {
      // ignore
    }
    throw new ApiClientError('UPSTREAM_UNAVAILABLE', msg, res.status, true);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const dataLine = block
        .split('\n')
        .find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      try {
        const parsed = JSON.parse(raw) as StreamEvent;
        onEvent(parsed);
      } catch {
        // ignore malformed chunk
      }
    }
  }
}
