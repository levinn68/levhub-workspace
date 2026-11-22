export type LevhubErrorCode =
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_AUTH_FAILED'
  | 'UNSUPPORTED_CAPABILITY'
  | 'MCP_CONNECT_FAILED'
  | 'TOOL_SCHEMA_INVALID'
  | 'APPROVAL_REQUIRED'
  | 'TOOL_EXECUTION_FAILED'
  | 'SKILL_INVALID'
  | 'SKILL_EXECUTION_FAILED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export interface ApiErrorEnvelope {
  error: {
    code: LevhubErrorCode;
    message: string;
    retryable: boolean;
    correlationId: string;
  };
}

export interface LevhubModel {
  id: string;
  displayName: string;
  provider?: string;
  capabilities?: {
    streaming?: boolean;
    tools?: boolean;
    vision?: boolean;
    contextLength?: number;
  };
  available: boolean;
  rawMetadata?: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: 'overdrive_mcp' | 'external_mcp' | 'skill';
  integrationId: string;
  destructive?: boolean;
}

export type ToolCallStatus =
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out';

export interface ToolCallRecord {
  id: string;
  conversation_id: string;
  message_id: string;
  source: 'overdrive_mcp' | 'external_mcp' | 'skill';
  integration_id: string | null;
  tool_name: string;
  arguments_redacted: Record<string, unknown>;
  status: ToolCallStatus;
  result_summary: string | null;
  error_code: string | null;
  correlation_id: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  workspace_id: string;
  title: string;
  model_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: Record<string, unknown>;
  sequence_no: number;
  model_id: string | null;
  status: string;
  created_at: string;
}

export interface IntegrationRecord {
  id: string;
  kind: 'mcp' | 'skill_source';
  source: 'overdrive' | 'external' | 'imported';
  display_name: string;
  config_public: Record<string, unknown>;
  secret_ref: string | null;
  status: string;
  enabled: boolean;
  last_health_check: string | null;
  created_at: string;
  updated_at: string;
}

export type SkillStatus =
  | 'discovered'
  | 'imported'
  | 'enabled'
  | 'disabled'
  | 'invalid'
  | 'error';

export interface SkillRecord {
  id: string;
  integration_id: string | null;
  slug: string;
  version: string | null;
  description: string;
  source: 'overdrive' | 'imported';
  status: SkillStatus;
  manifest: Record<string, unknown>;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export type ChatStreamEventType =
  | 'message.delta'
  | 'message.completed'
  | 'tool.pending'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'approval.required'
  | 'turn.error';

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  correlationId: string;
  conversationId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
