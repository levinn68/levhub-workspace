import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { z } from 'zod';

import { loadConfig } from './config.js';
import { LevhubRepository } from './db/supabase.js';
import { RouterAdapter } from './adapters/routerAdapter.js';
import { OverdriveAdapter } from './adapters/overdriveAdapter.js';
import { ExternalMcpAdapter, type ExternalMcpConnectionConfig } from './adapters/externalMcpAdapter.js';
import { SkillAdapter } from './adapters/skillAdapter.js';
import { ChatOrchestrator } from './services/chatOrchestrator.js';
import {
  createSession,
  decryptSecret,
  encryptSecret,
  revokeAllSessions,
  revokeSession,
  verifyPasswordHash,
  verifySessionToken,
} from './security/crypto.js';
import { LevhubError, normalizeUnknownError } from './security/errors.js';
import {
  checkLoginRateLimit,
  checkMutationRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from './security/rateLimit.js';
import { validateExternalEndpointUrl } from './security/ssrf.js';

const SESSION_COOKIE_NAME = 'levhub_session';
const CSRF_COOKIE_NAME = 'levhub_csrf';

const config = loadConfig();
const repo = new LevhubRepository(config);
const router = new RouterAdapter(config);
const overdrive = new OverdriveAdapter(config);
const externalMcp = new ExternalMcpAdapter(config);
const skillAdapter = new SkillAdapter(config, overdrive);
const chatOrchestrator = new ChatOrchestrator(config, repo, router, overdrive, externalMcp, skillAdapter);

const app = Fastify({
  logger: {
    level: config.isProd ? 'info' : 'debug',
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
  },
  bodyLimit: config.MAX_SKILL_ARCHIVE_BYTES + 1024 * 1024,
});

await app.register(cookie);
await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});
await app.register(multipart, {
  limits: {
    fileSize: config.MAX_SKILL_ARCHIVE_BYTES,
    files: 1,
  },
});

app.setErrorHandler((err, _req, reply) => {
  const normalized = normalizeUnknownError(err);
  reply.status(normalized.statusCode).send(normalized.toEnvelope());
});

function requireSession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token, config.APP_SESSION_SECRET);
  if (!session) {
    throw new LevhubError('AUTH_REQUIRED', 'Sesi tidak valid atau telah berakhir. Silakan login kembali.', 401);
  }

  // CSRF check for state-changing requests (S-013)
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    const headerCsrf = req.headers['x-levhub-csrf'];
    if (typeof headerCsrf !== 'string' || headerCsrf !== session.csrfToken) {
      throw new LevhubError('AUTH_REQUIRED', 'Validasi CSRF gagal. Muat ulang halaman dan coba lagi.', 403);
    }
    const clientIp = req.ip || 'owner';
    if (!checkMutationRateLimit(clientIp)) {
      throw new LevhubError('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.', 429, true);
    }
  }

  reply.header('X-Correlation-Id', crypto.randomUUID());
  return session;
}

function maskIntegration(item: {
  id: string;
  kind: string;
  source: string;
  display_name: string;
  config_public: Record<string, unknown>;
  secret_ref: string | null;
  status: string;
  enabled: boolean;
  last_health_check: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: item.id,
    kind: item.kind,
    source: item.source,
    displayName: item.display_name,
    config: item.config_public,
    hasSecret: Boolean(item.secret_ref),
    status: item.status,
    enabled: item.enabled,
    lastHealthCheck: item.last_health_check,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

// ============================================================================
// PUBLIC ENDPOINTS (Health & Auth)
// ============================================================================

app.get('/api/health', async () => {
  const [routerHealth, runtimeHealth, dbHealth] = await Promise.all([
    router.healthCheck(),
    overdrive.healthCheck(),
    repo.healthCheck(),
  ]);

  const overallOk = routerHealth.ok && dbHealth.ok;
  return {
    app: 'LEVHUB',
    status: overallOk ? 'healthy' : 'degraded',
    checkedAt: new Date().toISOString(),
    dependencies: {
      router: routerHealth,
      runtime: runtimeHealth,
      supabase: dbHealth,
    },
  };
});

app.post('/api/auth/login', async (req, reply) => {
  const clientKey = req.ip || 'owner';
  const rate = checkLoginRateLimit(clientKey);
  if (!rate.allowed) {
    reply.header('Retry-After', String(rate.retryAfterSec));
    throw new LevhubError(
      'RATE_LIMITED',
      `Terlalu banyak percobaan login gagal. Coba lagi dalam ${rate.retryAfterSec} detik.`,
      429,
      true,
    );
  }

  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    throw new LevhubError('INVALID_INPUT', 'Password wajib diisi.', 400);
  }

  const ok = verifyPasswordHash(parsed.data.password, config.APP_PASSWORD_HASH);
  if (!ok) {
    recordLoginFailure(clientKey);
    await repo.recordAuditEvent('login_failure', { ip: clientKey });
    throw new LevhubError('AUTH_REQUIRED', 'Kredensial tidak valid.', 401);
  }

  clearLoginFailures(clientKey);
  const { token, record } = createSession(config.APP_SESSION_SECRET, config.SESSION_TTL_HOURS);
  await repo.recordAuditEvent('login_success', { ip: clientKey });

  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });
  reply.setCookie(CSRF_COOKIE_NAME, record.csrfToken, {
    httpOnly: false,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_HOURS * 3600,
  });

  return { ok: true, workspaceName: config.WORKSPACE_NAME, csrfToken: record.csrfToken };
});

app.get('/api/auth/me', async (req) => {
  const token = req.cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token, config.APP_SESSION_SECRET);
  if (!session) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    workspaceName: config.WORKSPACE_NAME,
    csrfToken: session.csrfToken,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
});

app.post('/api/auth/logout', async (req, reply) => {
  revokeSession(req.cookies[SESSION_COOKIE_NAME]);
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  return { ok: true };
});

app.post('/api/auth/logout-all', async (req, reply) => {
  requireSession(req, reply);
  revokeAllSessions();
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  return { ok: true };
});

// ============================================================================
// MODEL CATALOG
// ============================================================================

app.get('/api/models', async (req, reply) => {
  requireSession(req, reply);
  return await router.listModels(false);
});

app.post('/api/models/refresh', async (req, reply) => {
  requireSession(req, reply);
  const catalog = await router.listModels(true);
  await repo.recordAuditEvent('model_catalog_refresh', { count: catalog.items.length });
  return catalog;
});

// ============================================================================
// CHAT & TOOL APPROVAL
// ============================================================================

app.post('/api/chat', async (req, reply) => {
  requireSession(req, reply);
  const parsed = z
    .object({
      conversationId: z.string().uuid().optional(),
      modelId: z.string().min(1),
      message: z.string().min(1).max(100_000),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    throw new LevhubError('INVALID_INPUT', 'Permintaan chat memerlukan modelId dan pesan yang valid.', 400);
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abortController = new AbortController();
  req.raw.on('close', () => abortController.abort());

  try {
    await chatOrchestrator.handleChatTurn({
      conversationId: parsed.data.conversationId,
      modelId: parsed.data.modelId,
      message: parsed.data.message,
      signal: abortController.signal,
      emit: (event) => {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      },
    });
  } catch (err) {
    const norm = normalizeUnknownError(err);
    reply.raw.write(`event: turn.error\ndata: ${JSON.stringify(norm.toEnvelope())}\n\n`);
  } finally {
    reply.raw.end();
  }
});

app.post('/api/chat/tool-calls/:id/decision', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const parsed = z.object({ approved: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    throw new LevhubError('INVALID_INPUT', 'Field approved (boolean) wajib diisi.', 400);
  }
  return await chatOrchestrator.decideToolCall(id, parsed.data.approved);
});

// ============================================================================
// CONVERSATIONS & HISTORY
// ============================================================================

app.get('/api/conversations', async (req, reply) => {
  requireSession(req, reply);
  const q = req.query as { cursor?: string; limit?: string; search?: string };
  const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
  return await repo.listConversations(limit, q.cursor, q.search);
});

app.post('/api/conversations', async (req, reply) => {
  requireSession(req, reply);
  const parsed = z
    .object({ title: z.string().min(1).max(160).optional(), modelId: z.string().nullable().optional() })
    .safeParse(req.body ?? {});
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Data percakapan tidak valid.', 400);
  return await repo.createConversation(parsed.data.title || 'Percakapan Baru', parsed.data.modelId ?? null);
});

app.get('/api/conversations/:id', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  return await repo.getConversation(id);
});

app.patch('/api/conversations/:id', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const parsed = z.object({ title: z.string().min(1).max(160) }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Judul percakapan tidak valid.', 400);
  return await repo.renameConversation(id, parsed.data.title.trim());
});

app.delete('/api/conversations/:id', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  await repo.deleteConversation(id);
  await repo.recordAuditEvent('conversation_deleted', { conversationId: id });
  return { deleted: true };
});

app.get('/api/conversations/:id/export', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const format = ((req.query as { format?: string }).format || 'markdown').toLowerCase();
  const data = await repo.getConversation(id);

  if (format === 'json') {
    reply.header('Content-Disposition', `attachment; filename="levhub-${id}.json"`);
    return data;
  }

  const lines = [`# ${data.conversation.title}`, `Model: ${data.conversation.model_id ?? '-'}`, ''];
  for (const m of data.messages) {
    lines.push(`## ${m.role.toUpperCase()} (${m.created_at})`);
    lines.push(typeof m.content.text === 'string' ? m.content.text : JSON.stringify(m.content, null, 2));
    lines.push('');
  }
  reply.type('text/markdown; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="levhub-${id}.md"`);
  return lines.join('\n');
});

// ============================================================================
// MCP HUB
// ============================================================================

app.get('/api/mcp', async (req, reply) => {
  requireSession(req, reply);
  const [saved, runtimeServers] = await Promise.all([
    repo.isConfigured() ? repo.listIntegrations('mcp') : Promise.resolve([]),
    overdrive.isConfigured() ? overdrive.listMcpServers().catch(() => []) : Promise.resolve([]),
  ]);

  return {
    runtimeServers,
    externalServers: saved.map(maskIntegration),
  };
});

app.post('/api/mcp/external', async (req, reply) => {
  requireSession(req, reply);
  const parsed = z
    .object({
      displayName: z.string().min(1).max(100),
      transport: z.enum(['streamable_http', 'sse']),
      endpoint: z.string().url(),
      authType: z.enum(['none', 'bearer', 'header']).default('none'),
      secret: z.string().optional(),
      customHeaderName: z.string().optional(),
      timeoutMs: z.number().int().min(2000).max(60000).optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    throw new LevhubError('INVALID_INPUT', 'Konfigurasi MCP eksternal tidak lengkap atau tidak valid.', 400);
  }

  await validateExternalEndpointUrl(parsed.data.endpoint, { allowHttpInDev: !config.isProd });

  const encryptedSecret = parsed.data.secret
    ? encryptSecret(parsed.data.secret, config.APP_ENCRYPTION_KEY)
    : null;

  const created = await repo.createIntegration({
    kind: 'mcp',
    source: 'external',
    display_name: parsed.data.displayName.trim(),
    config_public: {
      transport: parsed.data.transport,
      endpoint: parsed.data.endpoint,
      authType: parsed.data.authType,
      customHeaderName: parsed.data.customHeaderName ?? null,
      timeoutMs: parsed.data.timeoutMs ?? 20000,
    },
    secret_ref: encryptedSecret,
    status: 'configured',
    enabled: false,
  });

  await repo.recordAuditEvent('mcp_connected', { integrationId: created.id, displayName: created.display_name });
  return maskIntegration(created);
});

app.post('/api/mcp/:id/test', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const item = await repo.getIntegration(id);
  const cfg = item.config_public;
  const conn: ExternalMcpConnectionConfig = {
    id: item.id,
    endpoint: String(cfg.endpoint || ''),
    transport: cfg.transport === 'sse' ? 'sse' : 'streamable_http',
    authType: (cfg.authType as 'none' | 'bearer' | 'header') || 'none',
    customHeaderName: typeof cfg.customHeaderName === 'string' ? cfg.customHeaderName : undefined,
    secret: item.secret_ref ? decryptSecret(item.secret_ref, config.APP_ENCRYPTION_KEY) : undefined,
    timeoutMs: typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : undefined,
  };

  try {
    const result = await externalMcp.testConnection(conn);
    await repo.updateIntegration(id, { status: 'healthy', last_health_check: new Date().toISOString() });
    return result;
  } catch (err) {
    await repo.updateIntegration(id, { status: 'error', last_health_check: new Date().toISOString() });
    throw err;
  }
});

app.post('/api/mcp/:id/enable', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const updated = await repo.updateIntegration(id, { enabled: true });
  return maskIntegration(updated);
});

app.post('/api/mcp/:id/disable', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const updated = await repo.updateIntegration(id, { enabled: false });
  return maskIntegration(updated);
});

app.delete('/api/mcp/:id', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  externalMcp.invalidateCache(id);
  await repo.deleteIntegration(id);
  await repo.recordAuditEvent('mcp_disconnected', { integrationId: id });
  return { deleted: true };
});

app.get('/api/mcp/:id/tools', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const item = await repo.getIntegration(id);
  const cfg = item.config_public;
  const conn: ExternalMcpConnectionConfig = {
    id: item.id,
    endpoint: String(cfg.endpoint || ''),
    transport: cfg.transport === 'sse' ? 'sse' : 'streamable_http',
    authType: (cfg.authType as 'none' | 'bearer' | 'header') || 'none',
    customHeaderName: typeof cfg.customHeaderName === 'string' ? cfg.customHeaderName : undefined,
    secret: item.secret_ref ? decryptSecret(item.secret_ref, config.APP_ENCRYPTION_KEY) : undefined,
  };
  const tools = await externalMcp.listTools(conn, true);
  return { tools };
});

// ============================================================================
// SKILLS HUB
// ============================================================================

app.get('/api/skills', async (req, reply) => {
  requireSession(req, reply);
  const [imported, runtimeSkills] = await Promise.all([
    repo.isConfigured() ? repo.listSkills() : Promise.resolve([]),
    overdrive.isConfigured() ? overdrive.listSkills().catch(() => []) : Promise.resolve([]),
  ]);
  return { runtimeSkills, importedSkills: imported };
});

app.post('/api/skills/import', async (req, reply) => {
  requireSession(req, reply);

  // Supports both JSON paste ({ markdown }) and multipart file upload (SKILL.md or ZIP)
  if (req.isMultipart()) {
    const file = await req.file();
    if (!file) throw new LevhubError('INVALID_INPUT', 'File Skill wajib diunggah.', 400);
    const buffer = await file.toBuffer();
    const filename = file.filename.toLowerCase();

    if (filename.endsWith('.md')) {
      const manifest = skillAdapter.validateMarkdownPackage(buffer.toString('utf8'));
      const saved = await repo.upsertSkill({
        integration_id: null,
        slug: manifest.slug,
        version: manifest.version,
        description: manifest.description,
        source: 'imported',
        status: 'disabled', // Imported skills remain disabled until explicitly enabled (Security Req)
        manifest: manifest as unknown as Record<string, unknown>,
        storage_path: null,
      });
      await repo.recordAuditEvent('skill_imported', { slug: saved.slug, type: 'markdown' });
      return { skill: saved, validation: { ok: true, warnings: manifest.warnings } };
    }

    if (filename.endsWith('.zip')) {
      const { inspectZipArchiveBuffer } = await import('./security/zipValidator.js');
      const entries = inspectZipArchiveBuffer(buffer, { maxArchiveBytes: config.MAX_SKILL_ARCHIVE_BYTES });
      const slug = file.filename.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
      const saved = await repo.upsertSkill({
        integration_id: null,
        slug,
        version: '1.0.0',
        description: `Paket ZIP tervalidasi (${entries.length} file, termasuk SKILL.md).`,
        source: 'imported',
        status: 'disabled',
        manifest: { files: entries, validatedAt: new Date().toISOString() },
        storage_path: `${config.SUPABASE_STORAGE_BUCKET}/${slug}.zip`,
      });
      await repo.recordAuditEvent('skill_imported', { slug: saved.slug, type: 'zip', fileCount: entries.length });
      return { skill: saved, validation: { ok: true, fileCount: entries.length, warnings: [] } };
    }

    throw new LevhubError('SKILL_INVALID', 'Hanya file .zip atau SKILL.md yang didukung.', 400);
  }

  const parsed = z.object({ markdown: z.string().min(10).max(200_000) }).safeParse(req.body);
  if (!parsed.success) {
    throw new LevhubError('INVALID_INPUT', 'Konten SKILL.md wajib diisi.', 400);
  }

  const manifest = skillAdapter.validateMarkdownPackage(parsed.data.markdown);
  const saved = await repo.upsertSkill({
    integration_id: null,
    slug: manifest.slug,
    version: manifest.version,
    description: manifest.description,
    source: 'imported',
    status: 'disabled',
    manifest: manifest as unknown as Record<string, unknown>,
    storage_path: null,
  });
  await repo.recordAuditEvent('skill_imported', { slug: saved.slug, type: 'paste' });
  return { skill: saved, validation: { ok: true, warnings: manifest.warnings } };
});

app.post('/api/skills/:id/enable', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  const updated = await repo.updateSkillStatus(id, 'enabled');
  await repo.recordAuditEvent('skill_enabled', { skillId: id, slug: updated.slug });
  return updated;
});

app.post('/api/skills/:id/disable', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  return await repo.updateSkillStatus(id, 'disabled');
});

app.delete('/api/skills/:id', async (req, reply) => {
  requireSession(req, reply);
  const { id } = req.params as { id: string };
  await repo.deleteSkill(id);
  return { deleted: true };
});

// ============================================================================
// SETTINGS & OBSERVABILITY
// ============================================================================

app.get('/api/settings', async (req, reply) => {
  requireSession(req, reply);
  const preferences = repo.isConfigured() ? await repo.getSettings() : {};
  return {
    workspaceName: config.WORKSPACE_NAME,
    preferences,
    connections: {
      router: {
        endpoint: config.ROUTER_BASE_URL,
        hasApiKey: Boolean(config.ROUTER_API_KEY),
      },
      runtime: {
        endpoint: config.OVERDRIVE_BASE_URL || null,
        hasToken: Boolean(config.OVERDRIVE_API_TOKEN),
      },
      supabase: {
        configured: repo.isConfigured(),
        bucket: config.SUPABASE_STORAGE_BUCKET,
      },
    },
    limits: {
      maxToolCallsPerTurn: config.MAX_TOOL_CALLS_PER_TURN,
      toolExecutionTimeoutMs: config.TOOL_EXECUTION_TIMEOUT_MS,
      maxSkillArchiveBytes: config.MAX_SKILL_ARCHIVE_BYTES,
      sessionTtlHours: config.SESSION_TTL_HOURS,
    },
  };
});

app.patch('/api/settings', async (req, reply) => {
  requireSession(req, reply);
  const parsed = z
    .object({
      key: z.enum(['general', 'mcp', 'skills']),
      value: z.record(z.unknown()),
    })
    .safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Format pengaturan tidak valid.', 400);
  await repo.updateSetting(parsed.data.key, parsed.data.value);
  return { ok: true };
});

app.get('/api/audit/events', async (req, reply) => {
  requireSession(req, reply);
  const items = await repo.listRecentAuditEvents(40);
  return { items };
});

app.listen({ port: config.PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`LEVHUB API berjalan di port ${config.PORT}`);
});
