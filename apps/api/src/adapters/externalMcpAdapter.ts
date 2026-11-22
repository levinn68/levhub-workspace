import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
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
      if (error instanceof Error && /401|403|unauthorized|forbidden/i.test(error.message)) {
        throw new LevhubError(
          'MCP_CONNECT_FAILED',
          'Server MCP meminta autentikasi. Gunakan kredensial yang disediakan server; OAuth interaktif belum dikonfigurasi untuk koneksi ini.',
          401,
        );
      }
      if (error instanceof Error && /timeout|timed out|abort/i.test(error.message)) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'Koneksi MCP melewati batas waktu.', 504, true);
      }
      throw new LevhubError(
        'MCP_CONNECT_FAILED',
        error instanceof Error
          ? `Handshake MCP gagal: ${error.message.slice(0, 360)}`
          : 'Tidak dapat menginisialisasi koneksi MCP.',
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
      if (error instanceof Error && /401|403|unauthorized|forbidden/i.test(error.message)) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'Autentikasi ditolak oleh server MCP.', 401);
      }
      if (error instanceof Error && /timeout|timed out|abort/i.test(error.message)) {
        throw new LevhubError('MCP_CONNECT_FAILED', 'Operasi MCP melewati batas waktu.', 504, true);
      }
      throw new LevhubError(
        'MCP_CONNECT_FAILED',
        error instanceof Error ? error.message.slice(0, 500) : 'Operasi MCP gagal.',
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

  async callTool(
    conn: ExternalMcpConnectionConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string }> {
    const result = await this.withClient(conn, (client) =>
      client.callTool({ name: toolName, arguments: args }),
    );
    return {
      output: JSON.stringify(result).slice(0, this.config.MAX_TOOL_OUTPUT_BYTES),
    };
  }

  invalidateCache(connectionId: string): void {
    this.toolCache.delete(connectionId);
  }
}
