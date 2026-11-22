import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from './mcpClient.js';
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

type ConnectedClient = {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
};

/**
 * Official MCP SDK adapter.
 *
 * Every operation owns a short-lived MCP client connection. This avoids
 * relying on process-local sessions surviving between serverless invocations
 * while still letting the SDK handle initialize, negotiated protocol headers,
 * JSON-RPC, Streamable HTTP and legacy SSE framing.
 */
export class ExternalMcpAdapter {
  private readonly toolCache = new Map<string, { tools: ToolSchema[]; fetchedAt: number }>();

  constructor(private readonly config: AppConfig) {}

  private async connect(conn: ExternalMcpConnectionConfig): Promise<ConnectedClient> {
    const endpoint = await validateExternalEndpointUrl(conn.endpoint, {
      allowHttpInDev: !this.config.isProd,
    });
    const headers: Record<string, string> = { ...(conn.headers ?? {}) };
    if (conn.authType === 'bearer' && conn.secret) {
      headers.Authorization = `Bearer ${conn.secret}`;
    } else if (conn.authType === 'header' && conn.customHeaderName && conn.secret) {
      headers[conn.customHeaderName] = conn.secret;
    }

    const timeoutMs = Math.min(
      conn.timeoutMs ?? this.config.TOOL_EXECUTION_TIMEOUT_MS,
      60_000,
    );
    const requestInit: RequestInit = {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    };

    const client = new Client({
      name: 'LEVHUB',
      version: '1.0.0',
    });

    const transport = conn.transport === 'sse'
      ? new SSEClientTransport(endpoint, { requestInit })
      : new StreamableHTTPClientTransport(endpoint, { requestInit });

    try {
      await client.connect(transport);
      return { client, transport };
    } catch (error) {
      try { await client.close(); } catch { /* preserve original error */ }
      if (/401|403|unauthorized|forbidden/i.test(errorMessage(error))) {
        throw new LevhubError(
          'MCP_CONNECT_FAILED',
          'Server MCP meminta autentikasi. Gunakan kredensial yang disediakan server; OAuth interaktif belum dikonfigurasi untuk koneksi ini.',
          401,
        );
      }
      if (/timeout|timed out|abort/i.test(errorMessage(error))) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'Koneksi MCP melewati batas waktu.', 504, true);
      }
      throw new LevhubError(
        'MCP_CONNECT_FAILED',
        `Handshake MCP gagal: ${errorMessage(error).slice(0, 360)}`,
        502,
        true,
      );
    }
  }

  private async withClient<T>(
    conn: ExternalMcpConnectionConfig,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const connected = await this.connect(conn);
    try {
      return await operation(connected.client);
    } catch (error) {
      if (error instanceof LevhubError) throw error;
      if (/401|403|unauthorized|forbidden/i.test(errorMessage(error))) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'Autentikasi ditolak oleh server MCP.', 401);
      }
      if (/timeout|timed out|abort/i.test(errorMessage(error))) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'Operasi MCP melewati batas waktu.', 504, true);
      }
      throw new LevhubError(
        'MCP_CONNECT_FAILED',
        errorMessage(error).slice(0, 500) || 'Operasi MCP gagal.',
        502,
        true,
      );
    } finally {
      try { await connected.client.close(); } catch { /* connection already closed */ }
    }
  }

  async testConnection(conn: ExternalMcpConnectionConfig): Promise<{
    ok: boolean;
    toolCount: number;
    message: string;
  }> {
    this.toolCache.delete(conn.id);
    const tools = await this.listTools(conn, true);
    return {
      ok: true,
      toolCount: tools.length,
      message: `Terhubung melalui MCP SDK (${tools.length} tools ditemukan)`,
    };
  }

  async listTools(conn: ExternalMcpConnectionConfig, forceRefresh = false): Promise<ToolSchema[]> {
    const cached = this.toolCache.get(conn.id);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 120_000) {
      return cached.tools;
    }

    const tools = await this.withClient(conn, async (client) => {
      const result = await client.listTools();
      return result.tools
        .filter((tool) => typeof tool.name === 'string' && tool.name.length > 0)
        .map((tool) => ({
          name: String(tool.name),
          description: String(tool.description || ''),
          parameters: (tool.inputSchema || { type: 'object', properties: {} }) as Record<string, unknown>,
          source: 'external_mcp' as const,
          integrationId: conn.id,
          destructive: Boolean((tool.annotations as Record<string, unknown> | undefined)?.destructive),
        }));
    });

    this.toolCache.set(conn.id, { tools, fetchedAt: Date.now() });
    return tools;
  }

  /**
   * Returns the human-readable text of an MCP tool result plus structured
   * content, without corrupting JSON.
   *
   * Root cause fixed here: the previous implementation did
   * `JSON.stringify(result).slice(0, MAX)`, which cut the JSON mid-token and
   * produced invalid payloads for the model. We now serialize first, and only
   * truncate as a last resort with an explicit marker.
   */
  async callTool(
    conn: ExternalMcpConnectionConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string }> {
    const result = await this.withClient(conn, (client) =>
      client.callTool({ name: toolName, arguments: args }),
    );

    const structured = result as {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    };

    const maxBytes = this.config.MAX_TOOL_OUTPUT_BYTES;
    let text = '';

    if (Array.isArray(structured.content)) {
      const textParts = structured.content
        .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string);
      if (textParts.length > 0) {
        text = textParts.join('\n');
      }
    }

    if (!text && structured.structuredContent !== undefined) {
      text = JSON.stringify(structured.structuredContent);
    }

    if (!text) {
      text = JSON.stringify(result);
    }

    if (structured.isError) {
      text = `[tool melaporkan error]\n${text}`;
    }

    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      // Truncate on a character boundary and flag it so the model is not misled.
      const truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
      text = `${truncated}\n\n[output dipotong: melebihi ${maxBytes} byte]`;
    }

    return { output: text };
  }

  invalidateCache(connectionId: string): void {
    this.toolCache.delete(connectionId);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'unknown error';
  }
}
