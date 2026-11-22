import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import type {
  ConversationRecord,
  IntegrationRecord,
  MessageRecord,
  SkillRecord,
  ToolCallRecord,
} from '../types.js';
import { LevhubError } from '../security/errors.js';
import { redactObject } from '../security/redaction.js';

export class LevhubRepository {
  private client: SupabaseClient | null = null;
  private readonly workspaceId: string;

  constructor(private readonly config: AppConfig) {
    this.workspaceId = config.WORKSPACE_ID;
    if (config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
      this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private db(): SupabaseClient {
    if (!this.client) {
      throw new LevhubError(
        'UPSTREAM_UNAVAILABLE',
        'Supabase belum dikonfigurasi pada backend LEVHUB.',
        503,
        true,
      );
    }
    return this.client;
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const started = Date.now();
    if (!this.client) {
      return { ok: false, latencyMs: 0, message: 'SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diisi.' };
    }
    try {
      const { error } = await this.client.from('workspaces').select('id').eq('id', this.workspaceId).limit(1);
      if (error) {
        return { ok: false, latencyMs: Date.now() - started, message: error.message };
      }
      return { ok: true, latencyMs: Date.now() - started, message: 'Terhubung' };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Gagal terhubung ke Supabase',
      };
    }
  }

  async listConversations(limit = 30, cursor?: string, query?: string): Promise<{ items: ConversationRecord[]; nextCursor: string | null }> {
    let req = this.db()
      .from('conversations')
      .select('*')
      .eq('workspace_id', this.workspaceId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) req = req.lt('updated_at', cursor);
    if (query) req = req.ilike('title', `%${query}%`);

    const { data, error } = await req;
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal memuat daftar percakapan.', 500, true);
    const rows = (data ?? []) as ConversationRecord[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].updated_at : null;
    return { items, nextCursor };
  }

  async createConversation(title: string, modelId: string | null): Promise<ConversationRecord> {
    const { data, error } = await this.db()
      .from('conversations')
      .insert({ workspace_id: this.workspaceId, title, model_id: modelId })
      .select('*')
      .single();
    if (error || !data) throw new LevhubError('INTERNAL_ERROR', 'Gagal membuat percakapan baru.', 500, true);
    return data as ConversationRecord;
  }

  async getConversation(id: string): Promise<{ conversation: ConversationRecord; messages: MessageRecord[]; toolCalls: ToolCallRecord[] }> {
    const { data: conv, error: convErr } = await this.db()
      .from('conversations')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', this.workspaceId)
      .is('deleted_at', null)
      .single();

    if (convErr || !conv) throw new LevhubError('NOT_FOUND', 'Percakapan tidak ditemukan.', 404);

    const [{ data: msgs }, { data: calls }] = await Promise.all([
      this.db().from('messages').select('*').eq('conversation_id', id).order('sequence_no', { ascending: true }),
      this.db().from('tool_calls').select('*').eq('conversation_id', id).order('created_at', { ascending: true }),
    ]);

    return {
      conversation: conv as ConversationRecord,
      messages: (msgs ?? []) as MessageRecord[],
      toolCalls: (calls ?? []) as ToolCallRecord[],
    };
  }

  async renameConversation(id: string, title: string): Promise<ConversationRecord> {
    const { data, error } = await this.db()
      .from('conversations')
      .update({ title })
      .eq('id', id)
      .eq('workspace_id', this.workspaceId)
      .is('deleted_at', null)
      .select('*')
      .single();
    if (error || !data) throw new LevhubError('NOT_FOUND', 'Percakapan tidak ditemukan.', 404);
    return data as ConversationRecord;
  }

  async deleteConversation(id: string): Promise<void> {
    const { error } = await this.db()
      .from('conversations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', this.workspaceId);
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal menghapus percakapan.', 500, true);
  }

  async appendMessage(
    conversationId: string,
    role: MessageRecord['role'],
    content: Record<string, unknown>,
    modelId: string | null,
    status = 'completed',
  ): Promise<MessageRecord> {
    const { data: last } = await this.db()
      .from('messages')
      .select('sequence_no')
      .eq('conversation_id', conversationId)
      .order('sequence_no', { ascending: false })
      .limit(1);

    const nextSeq = last && last.length > 0 ? Number(last[0].sequence_no) + 1 : 1;

    const { data, error } = await this.db()
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
        sequence_no: nextSeq,
        model_id: modelId,
        status,
      })
      .select('*')
      .single();

    if (error || !data) throw new LevhubError('INTERNAL_ERROR', 'Gagal menyimpan pesan ke Supabase.', 500, true);

    await this.db()
      .from('conversations')
      .update({ updated_at: new Date().toISOString(), ...(modelId ? { model_id: modelId } : {}) })
      .eq('id', conversationId);

    return data as MessageRecord;
  }

  async createToolCall(record: Omit<ToolCallRecord, 'id' | 'created_at'>): Promise<ToolCallRecord> {
    const { data, error } = await this.db()
      .from('tool_calls')
      .insert({
        ...record,
        arguments_redacted: redactObject(record.arguments_redacted),
      })
      .select('*')
      .single();
    if (error || !data) throw new LevhubError('INTERNAL_ERROR', 'Gagal mencatat tool call.', 500);
    return data as ToolCallRecord;
  }

  async updateToolCall(id: string, patch: Partial<ToolCallRecord>): Promise<ToolCallRecord> {
    const { data, error } = await this.db().from('tool_calls').update(patch).eq('id', id).select('*').single();
    if (error || !data) throw new LevhubError('NOT_FOUND', 'Tool call tidak ditemukan.', 404);
    return data as ToolCallRecord;
  }

  async getToolCall(id: string): Promise<ToolCallRecord> {
    const { data, error } = await this.db().from('tool_calls').select('*').eq('id', id).single();
    if (error || !data) throw new LevhubError('NOT_FOUND', 'Tool call tidak ditemukan.', 404);
    return data as ToolCallRecord;
  }

  async listIntegrations(kind?: 'mcp' | 'skill_source'): Promise<IntegrationRecord[]> {
    let req = this.db().from('integrations').select('*').order('created_at', { ascending: false });
    if (kind) req = req.eq('kind', kind);
    const { data, error } = await req;
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal memuat daftar integrasi.', 500, true);
    return (data ?? []) as IntegrationRecord[];
  }

  async getIntegration(id: string): Promise<IntegrationRecord> {
    const { data, error } = await this.db().from('integrations').select('*').eq('id', id).single();
    if (error || !data) throw new LevhubError('NOT_FOUND', 'Integrasi tidak ditemukan.', 404);
    return data as IntegrationRecord;
  }

  async createIntegration(payload: {
    kind: 'mcp' | 'skill_source';
    source: 'overdrive' | 'external' | 'imported';
    display_name: string;
    config_public: Record<string, unknown>;
    secret_ref: string | null;
    status: string;
    enabled: boolean;
  }): Promise<IntegrationRecord> {
    const { data, error } = await this.db().from('integrations').insert(payload).select('*').single();
    if (error || !data) throw new LevhubError('INTERNAL_ERROR', 'Gagal menyimpan integrasi.', 500);
    return data as IntegrationRecord;
  }

  async updateIntegration(id: string, patch: Partial<IntegrationRecord>): Promise<IntegrationRecord> {
    const { data, error } = await this.db().from('integrations').update(patch).eq('id', id).select('*').single();
    if (error || !data) throw new LevhubError('NOT_FOUND', 'Integrasi tidak ditemukan.', 404);
    return data as IntegrationRecord;
  }

  async deleteIntegration(id: string): Promise<void> {
    const { error } = await this.db().from('integrations').delete().eq('id', id);
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal menghapus integrasi.', 500);
  }

  async listSkills(): Promise<SkillRecord[]> {
    const { data, error } = await this.db().from('skills').select('*').order('updated_at', { ascending: false });
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal memuat daftar Skills.', 500, true);
    return (data ?? []) as SkillRecord[];
  }

  async upsertSkill(payload: Omit<SkillRecord, 'id' | 'created_at' | 'updated_at'>): Promise<SkillRecord> {
    const { data, error } = await this.db()
      .from('skills')
      .upsert(payload, { onConflict: 'slug,source' })
      .select('*')
      .single();
    if (error || !data) throw new LevhubError('INTERNAL_ERROR', 'Gagal menyimpan Skill.', 500);
    return data as SkillRecord;
  }

  async updateSkillStatus(id: string, status: SkillRecord['status']): Promise<SkillRecord> {
    const { data, error } = await this.db().from('skills').update({ status }).eq('id', id).select('*').single();
    if (error || !data) throw new LevhubError('NOT_FOUND', 'Skill tidak ditemukan.', 404);
    return data as SkillRecord;
  }

  async deleteSkill(id: string): Promise<void> {
    const { error } = await this.db().from('skills').delete().eq('id', id);
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal menghapus Skill.', 500);
  }

  async getSettings(): Promise<Record<string, unknown>> {
    const { data, error } = await this.db().from('app_settings').select('*');
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal memuat pengaturan.', 500);
    const out: Record<string, unknown> = {};
    for (const row of data ?? []) {
      out[row.key as string] = row.value;
    }
    return out;
  }

  async updateSetting(key: string, value: Record<string, unknown>): Promise<void> {
    const { error } = await this.db()
      .from('app_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new LevhubError('INTERNAL_ERROR', 'Gagal menyimpan pengaturan.', 500);
  }

  async recordAuditEvent(eventType: string, metadata: Record<string, unknown>, correlationId?: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('audit_events').insert({
        event_type: eventType,
        actor: 'owner',
        correlation_id: correlationId ?? null,
        metadata_redacted: redactObject(metadata),
      });
    } catch {
      // Never crash primary request on audit write failure
    }
  }

  async listRecentAuditEvents(limit = 30): Promise<Array<Record<string, unknown>>> {
    if (!this.client) return [];
    const { data } = await this.client
      .from('audit_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as Array<Record<string, unknown>>;
  }
}
