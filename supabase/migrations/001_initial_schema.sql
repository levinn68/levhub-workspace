-- LEVHUB Workspace schema, isolated from existing OVERDRIVE objects.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.levhub_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.levhub_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.levhub_workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  model_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.levhub_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.levhub_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content JSONB NOT NULL,
  sequence_no BIGINT NOT NULL,
  model_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_levhub_messages_conversation_seq UNIQUE (conversation_id, sequence_no)
);
CREATE TABLE IF NOT EXISTS public.levhub_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.levhub_conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.levhub_messages(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('external_mcp','skill')),
  integration_id UUID,
  tool_name TEXT NOT NULL,
  arguments_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','approved','denied','running','succeeded','failed','timed_out')),
  result_summary TEXT,
  error_code TEXT,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.levhub_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('mcp','skill_source')),
  source TEXT NOT NULL CHECK (source IN ('external','imported')),
  display_name TEXT NOT NULL,
  config_public JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_ref TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_health_check TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.levhub_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES public.levhub_integrations(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  version TEXT,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source = 'imported'),
  status TEXT NOT NULL CHECK (status IN ('discovered','imported','enabled','disabled','invalid','error')),
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_levhub_skills_slug_source UNIQUE (slug, source)
);
CREATE TABLE IF NOT EXISTS public.levhub_app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.levhub_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'owner',
  correlation_id UUID,
  metadata_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_levhub_conversations_workspace_active ON public.levhub_conversations(workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_levhub_messages_conversation_seq ON public.levhub_messages(conversation_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_levhub_tool_calls_conversation_created ON public.levhub_tool_calls(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_levhub_integrations_kind_source_enabled ON public.levhub_integrations(kind, source, enabled);
CREATE INDEX IF NOT EXISTS idx_levhub_skills_slug_version ON public.levhub_skills(slug, version);
CREATE INDEX IF NOT EXISTS idx_levhub_audit_events_created_desc ON public.levhub_audit_events(created_at DESC);

ALTER TABLE public.levhub_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levhub_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.levhub_workspaces, public.levhub_conversations, public.levhub_messages, public.levhub_tool_calls, public.levhub_integrations, public.levhub_skills, public.levhub_app_settings, public.levhub_audit_events FROM anon, authenticated;
GRANT ALL ON TABLE public.levhub_workspaces, public.levhub_conversations, public.levhub_messages, public.levhub_tool_calls, public.levhub_integrations, public.levhub_skills, public.levhub_app_settings, public.levhub_audit_events TO service_role;

CREATE OR REPLACE FUNCTION public.levhub_workspace_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_levhub_workspaces_updated_at ON public.levhub_workspaces;
CREATE TRIGGER trg_levhub_workspaces_updated_at BEFORE UPDATE ON public.levhub_workspaces FOR EACH ROW EXECUTE FUNCTION public.levhub_workspace_set_updated_at();
DROP TRIGGER IF EXISTS trg_levhub_conversations_updated_at ON public.levhub_conversations;
CREATE TRIGGER trg_levhub_conversations_updated_at BEFORE UPDATE ON public.levhub_conversations FOR EACH ROW EXECUTE FUNCTION public.levhub_workspace_set_updated_at();
DROP TRIGGER IF EXISTS trg_levhub_integrations_updated_at ON public.levhub_integrations;
CREATE TRIGGER trg_levhub_integrations_updated_at BEFORE UPDATE ON public.levhub_integrations FOR EACH ROW EXECUTE FUNCTION public.levhub_workspace_set_updated_at();
DROP TRIGGER IF EXISTS trg_levhub_skills_updated_at ON public.levhub_skills;
CREATE TRIGGER trg_levhub_skills_updated_at BEFORE UPDATE ON public.levhub_skills FOR EACH ROW EXECUTE FUNCTION public.levhub_workspace_set_updated_at();

INSERT INTO public.levhub_workspaces(id,name) VALUES ('00000000-0000-4000-8000-000000000001','LEVHUB Personal Workspace') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.levhub_app_settings(key,value) VALUES
('general','{"defaultModelId":null,"theme":"dark","locale":"id-ID","timezone":"Asia/Jakarta"}'::jsonb),
('mcp','{"defaultTimeoutMs":20000,"requireApprovalForMutations":true}'::jsonb),
('skills','{"maxArchiveBytes":10485760,"allowAutoEnable":false}'::jsonb)
ON CONFLICT(key) DO NOTHING;
INSERT INTO storage.buckets(id,name,public) VALUES ('levhub-skills','levhub-skills',FALSE) ON CONFLICT(id) DO NOTHING;
