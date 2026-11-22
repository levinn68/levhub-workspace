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

/**
 * External MCP Client Adapter supporting Streamable HTTP & SSE JSON-RPC endpoints.
 * Enforces SSRF protection, redirect blocking, timeouts, and output caps on every call.
 */
export class ExternalMcpAdapter {
  private readonly toolCache = new Map<string, { tools: ToolSchema[]; fetchedAt: number }>();

  constructor(private readonly config: AppConfig) {}

  private buildHeaders(conn: ExternalMcpConnectionConfig): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(conn.headers ?? {}),
    };
    if (conn.authType === 'bearer' && conn.secret) {
      h.Authorization = `Bearer ${conn.secret}`;
    } else if (conn.authType === 'header' && conn.customHeaderName && conn.secret) {
      h[conn.customHeaderName] = conn.secret;
    }
    return h;
  }

  private async rpc(
    conn: ExternalMcpConnectionConfig,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const safeUrl = await validateExternalEndpointUrl(conn.endpoint, {
      allowHttpInDev: !this.config.isProd,
    });

    const timeout = Math.min(conn.timeoutMs ?? this.config.TOOL_EXECUTION_TIMEOUT_MS, 60_000);
    const res = await fetch(safeUrl.toString(), {
      method: 'POST',
      headers: this.buildHeaders(conn),
      redirect: 'error', // Prevent redirect-based SSRF bypass
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${Date.now()}`,
        method,
        params,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      throw new LevhubError('MCP_CONNECT_FAILED', `Server MCP eksternal mengembalikan HTTP ${res.status}.`, 502, true);
    }

    const rawText = (await res.text()).slice(0, this.config.MAX_TOOL_OUTPUT_BYTES);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new LevhubError('MCP_CONNECT_FAILED', 'Respons server MCP bukan JSON-RPC yang valid.', 502);
    }

    if (parsed.error) {
      throw new LevhubError('TOOL_EXECUTION_FAILED', 'Server MCP mengembalikan error saat eksekusi.', 502);
    }
    return (parsed.result as Record<string, unknown>) ?? {};
  }

  async testConnection(conn: ExternalMcpConnectionConfig): Promise<{ ok: boolean; toolCount: number; message: string }> {
    const tools = await this.listTools(conn, true);
    return { ok: true, toolCount: tools.length, message: `Terhubung (${tools.length} tools ditemukan)` };
  }

  async listTools(conn: ExternalMcpConnectionConfig, forceRefresh = false): Promise<ToolSchema[]> {
    const cached = this.toolCache.get(conn.id);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 120_000) {
      return cached.tools;
    }
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

  async callTool(
    conn: ExternalMcpConnectionConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string }> {
    const result = await this.rpc(conn, 'tools/call', { name: toolName, arguments: args });
    const serialized = JSON.stringify(result);
    return { output: serialized.slice(0, this.config.MAX_TOOL_OUTPUT_BYTES) };
  }

  invalidateCache(connectionId: string): void {
    this.toolCache.delete(connectionId);
  }
}
