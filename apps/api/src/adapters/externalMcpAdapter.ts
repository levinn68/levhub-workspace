import type { AppConfig } from '../config.js';
import type { ToolSchema } from '../types.js';
import { LevhubError } from '../security/errors.js';
import { validateExternalEndpointUrl } from '../security/ssrf.js';

export interface ExternalMcpConnectionConfig {
  id: string;
  endpoint: string;
  transport: 'streamable_http' | 'sse';
  authType: 'none' | 'bearer' | 'header';
  secret?: string;
  customHeaderName?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

type McpSession = { sessionId?: string; protocolVersion: string; initialized: boolean };

/**
 * Streamable HTTP MCP client. Performs the MCP lifecycle handshake, preserves
 * session/protocol headers, and accepts both JSON and SSE response bodies.
 */
export class ExternalMcpAdapter {
  private readonly toolCache = new Map<string, { tools: ToolSchema[]; fetchedAt: number }>();
  private readonly sessions = new Map<string, McpSession>();
  private requestId = 0;

  constructor(private readonly config: AppConfig) {}

  private buildHeaders(conn: ExternalMcpConnectionConfig, session?: McpSession): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(conn.headers ?? {}),
    };
    if (session?.initialized) h['MCP-Protocol-Version'] = session.protocolVersion;
    if (session?.sessionId) h['MCP-Session-Id'] = session.sessionId;
    if (conn.authType === 'bearer' && conn.secret) h.Authorization = `Bearer ${conn.secret}`;
    else if (conn.authType === 'header' && conn.customHeaderName && conn.secret) h[conn.customHeaderName] = conn.secret;
    return h;
  }

  private async send(
    conn: ExternalMcpConnectionConfig,
    message: Record<string, unknown>,
    session?: McpSession,
  ): Promise<{ result: Record<string, unknown>; sessionId?: string; protocolVersion?: string }> {
    const safeUrl = await validateExternalEndpointUrl(conn.endpoint, { allowHttpInDev: !this.config.isProd });
    const timeout = Math.min(conn.timeoutMs ?? this.config.TOOL_EXECUTION_TIMEOUT_MS, 60_000);
    let res: Response;
    try {
      res = await fetch(safeUrl.toString(), {
        method: 'POST',
        headers: this.buildHeaders(conn, session),
        redirect: 'error',
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw new LevhubError('MCP_CONNECT_FAILED', 'Koneksi MCP melewati batas waktu.', 504, true);
      throw new LevhubError('MCP_CONNECT_FAILED', 'Tidak dapat menjangkau endpoint MCP. Periksa URL dan jaringan server.', 502, true);
    }

    if (res.status === 401 || res.status === 403) {
      throw new LevhubError('MCP_CONNECT_FAILED', 'Server MCP meminta autentikasi. LEVHUB belum menyelesaikan OAuth otomatis untuk server ini; gunakan token/header yang disediakan server jika tersedia.', 401);
    }
    if (!res.ok) {
      const detail = res.status === 404 && session?.sessionId
        ? 'Sesi MCP berakhir. Coba tes koneksi ulang untuk membuat sesi baru.'
        : `Server MCP mengembalikan HTTP ${res.status}. Pastikan URL yang dimasukkan adalah endpoint MCP, bukan halaman katalog atau dokumentasi.`;
      throw new LevhubError('MCP_CONNECT_FAILED', detail, 502, true);
    }

    const sessionId = res.headers.get('MCP-Session-Id') || undefined;
    const protocolVersion = res.headers.get('MCP-Protocol-Version') || undefined;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (res.status === 202 || res.status === 204) return { result: {}, sessionId, protocolVersion };

    const rawText = (await res.text()).slice(0, this.config.MAX_TOOL_OUTPUT_BYTES);
    let parsed: Record<string, unknown> | undefined;
    if (contentType.includes('text/event-stream')) {
      for (const line of rawText.split(/\\r?\\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const candidate = JSON.parse(data) as Record<string, unknown>;
          if (candidate.jsonrpc === '2.0' && ('result' in candidate || 'error' in candidate)) parsed = candidate;
        } catch { /* Ignore SSE comments and non-JSON event data. */ }
      }
    } else if (contentType.includes('application/json') || rawText.trim().startsWith('{')) {
      try { parsed = JSON.parse(rawText) as Record<string, unknown>; } catch { /* handled below */ }
    }

    if (!parsed) {
      const looksLikeHtml = /<\\s*!doctype html|<\\s*html/i.test(rawText);
      const hint = looksLikeHtml
        ? 'Endpoint mengembalikan halaman HTML, bukan MCP. URL katalog/dokumentasi tidak bisa dipakai sebagai endpoint koneksi.'
        : `Format respons tidak didukung (Content-Type: ${contentType || 'tidak diketahui'}).`;
      throw new LevhubError('MCP_CONNECT_FAILED', hint, 502);
    }
    if (parsed.error) {
      const rpcError = parsed.error as { code?: number; message?: string };
      throw new LevhubError('MCP_CONNECT_FAILED', `MCP JSON-RPC error ${rpcError.code ?? ''}: ${rpcError.message || 'Permintaan ditolak server.'}`.trim(), 502);
    }
    return { result: (parsed.result as Record<string, unknown>) ?? {}, sessionId, protocolVersion };
  }

  private async initialize(conn: ExternalMcpConnectionConfig, force = false): Promise<McpSession> {
    if (conn.transport !== 'streamable_http') {
      throw new LevhubError('MCP_CONNECT_FAILED', 'Transport SSE legacy belum didukung oleh adapter ini. Pilih Streamable HTTP jika server menyediakannya.', 400);
    }
    const existing = this.sessions.get(conn.id);
    if (existing?.initialized && !force) return existing;

    const requestedVersion = '2025-11-25';
    const init = await this.send(conn, {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'initialize',
      params: {
        protocolVersion: requestedVersion,
        capabilities: {},
        clientInfo: { name: 'LEVHUB', version: '1.0.0' },
      },
    });
    const negotiated = typeof init.result.protocolVersion === 'string' ? init.result.protocolVersion : requestedVersion;
    const session: McpSession = { sessionId: init.sessionId, protocolVersion: negotiated, initialized: true };
    this.sessions.set(conn.id, session);

    await this.send(conn, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, session);
    return session;
  }

  private async rpc(
    conn: ExternalMcpConnectionConfig,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const session = await this.initialize(conn);
    const response = await this.send(conn, {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }, session);
    if (response.sessionId && response.sessionId !== session.sessionId) {
      session.sessionId = response.sessionId;
      this.sessions.set(conn.id, session);
    }
    return response.result;
  }

  async testConnection(conn: ExternalMcpConnectionConfig): Promise<{ ok: boolean; toolCount: number; message: string }> {
    this.sessions.delete(conn.id);
    this.toolCache.delete(conn.id);
    const tools = await this.listTools(conn, true);
    return { ok: true, toolCount: tools.length, message: `Terhubung dan terinisialisasi (${tools.length} tools ditemukan)` };
  }

  async listTools(conn: ExternalMcpConnectionConfig, forceRefresh = false): Promise<ToolSchema[]> {
    const cached = this.toolCache.get(conn.id);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 120_000) return cached.tools;
    const result = await this.rpc(conn, 'tools/list', {});
    const rawTools = Array.isArray(result.tools) ? (result.tools as Array<Record<string, unknown>>) : [];
    const tools: ToolSchema[] = rawTools
      .filter((t) => typeof t.name === 'string')
      .map((t) => ({
        name: String(t.name),
        description: String(t.description || ''),
        parameters: (t.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
        source: 'external_mcp' as const,
        integrationId: conn.id,
        destructive: Boolean(t.destructive),
      }));
    this.toolCache.set(conn.id, { tools, fetchedAt: Date.now() });
    return tools;
  }

  async callTool(conn: ExternalMcpConnectionConfig, toolName: string, args: Record<string, unknown>): Promise<{ output: string }> {
    const result = await this.rpc(conn, 'tools/call', { name: toolName, arguments: args });
    return { output: JSON.stringify(result).slice(0, this.config.MAX_TOOL_OUTPUT_BYTES) };
  }

  invalidateCache(connectionId: string): void {
    this.toolCache.delete(connectionId);
    this.sessions.delete(connectionId);
  }
}
