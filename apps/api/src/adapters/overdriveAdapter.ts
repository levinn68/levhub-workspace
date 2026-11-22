import type { AppConfig } from '../config.js';
import type { ToolSchema } from '../types.js';
import { LevhubError } from '../security/errors.js';

export interface RuntimeMcpServer {
  id: string;
  name: string;
  status: string;
  transport: string;
  tools: ToolSchema[];
}

export interface RuntimeSkillEntry {
  slug: string;
  name: string;
  version: string | null;
  description: string;
  requiredTools: string[];
}

/**
 * Adapter for connecting LEVHUB to an upstream OVERDRIVE-compatible runtime.
 * Never fabricates upstream data when OVERDRIVE_BASE_URL is unconfigured.
 */
export class OverdriveAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.OVERDRIVE_BASE_URL.replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.OVERDRIVE_API_TOKEN) {
      h.Authorization = `Bearer ${this.config.OVERDRIVE_API_TOKEN}`;
    }
    return h;
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const started = Date.now();
    if (!this.baseUrl) {
      return { ok: false, latencyMs: 0, message: 'Runtime upstream belum dikonfigurasi (OVERDRIVE_BASE_URL kosong).' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(6000),
      });
      return {
        ok: res.ok,
        latencyMs: Date.now() - started,
        message: res.ok ? 'Terhubung' : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Runtime tidak terjangkau',
      };
    }
  }

  async listMcpServers(): Promise<RuntimeMcpServer[]> {
    if (!this.baseUrl) return [];
    const res = await fetch(`${this.baseUrl}${this.config.OVERDRIVE_MCP_LIST_PATH}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.config.OVERDRIVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new LevhubError('UPSTREAM_UNAVAILABLE', `Gagal mengambil daftar MCP runtime (HTTP ${res.status}).`, 502, true);
    }
    const json = (await res.json()) as { items?: Array<Record<string, unknown>>; servers?: Array<Record<string, unknown>> };
    const list = Array.isArray(json.items) ? json.items : Array.isArray(json.servers) ? json.servers : [];
    return list.map((srv) => ({
      id: String(srv.id || srv.name || 'unknown'),
      name: String(srv.name || srv.displayName || srv.id || 'Runtime MCP'),
      status: String(srv.status || 'connected'),
      transport: String(srv.transport || 'runtime'),
      tools: Array.isArray(srv.tools)
        ? (srv.tools as Array<Record<string, unknown>>).map((t) => ({
            name: String(t.name),
            description: String(t.description || ''),
            parameters: (t.inputSchema as Record<string, unknown>) || (t.parameters as Record<string, unknown>) || { type: 'object', properties: {} },
            source: 'overdrive_mcp' as const,
            integrationId: String(srv.id || srv.name || 'runtime'),
            destructive: Boolean(t.destructive),
          }))
        : [],
    }));
  }

  async listSkills(): Promise<RuntimeSkillEntry[]> {
    if (!this.baseUrl) return [];
    const res = await fetch(`${this.baseUrl}${this.config.OVERDRIVE_SKILLS_LIST_PATH}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.config.OVERDRIVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new LevhubError('UPSTREAM_UNAVAILABLE', `Gagal mengambil katalog Skills runtime (HTTP ${res.status}).`, 502, true);
    }
    const json = (await res.json()) as { items?: Array<Record<string, unknown>>; skills?: Array<Record<string, unknown>> };
    const list = Array.isArray(json.items) ? json.items : Array.isArray(json.skills) ? json.skills : [];
    return list.map((sk) => ({
      slug: String(sk.slug || sk.name || 'skill'),
      name: String(sk.name || sk.slug || 'Runtime Skill'),
      version: typeof sk.version === 'string' ? sk.version : null,
      description: String(sk.description || ''),
      requiredTools: Array.isArray(sk.requiredTools) ? sk.requiredTools.map(String) : [],
    }));
  }

  async executeMcpTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ output: string }> {
    if (!this.baseUrl) {
      throw new LevhubError('UNSUPPORTED_CAPABILITY', 'OVERDRIVE_BASE_URL belum dikonfigurasi.', 503);
    }
    const res = await fetch(
      `${this.baseUrl}/v1/mcp/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/execute`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ arguments: args }),
        signal: AbortSignal.timeout(this.config.TOOL_EXECUTION_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      throw new LevhubError('TOOL_EXECUTION_FAILED', `Eksekusi MCP runtime gagal (HTTP ${res.status}).`, 502, true);
    }
    const text = await res.text();
    return { output: text.slice(0, this.config.MAX_TOOL_OUTPUT_BYTES) };
  }

  async executeSkill(skillSlug: string, input: Record<string, unknown>): Promise<{ output: string }> {
    if (!this.baseUrl) {
      throw new LevhubError('UNSUPPORTED_CAPABILITY', 'OVERDRIVE_BASE_URL belum dikonfigurasi untuk eksekusi Skill.', 503);
    }
    const res = await fetch(`${this.baseUrl}/v1/skills/${encodeURIComponent(skillSlug)}/execute`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(this.config.TOOL_EXECUTION_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new LevhubError('SKILL_EXECUTION_FAILED', `Eksekusi Skill runtime gagal (HTTP ${res.status}).`, 502, true);
    }
    const text = await res.text();
    return { output: text.slice(0, this.config.MAX_TOOL_OUTPUT_BYTES) };
  }
}
