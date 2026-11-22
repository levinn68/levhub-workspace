import crypto from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { z } from 'zod';

import { loadConfig } from './config.js';
import { LevhubRepository } from './db/supabase.js';
import { RouterAdapter } from './adapters/routerAdapter.js';
import { ExternalMcpAdapter, type ExternalMcpConnectionConfig } from './adapters/externalMcpAdapter.js';
import { SkillAdapter } from './adapters/skillAdapter.js';
import { ChatOrchestrator } from './services/chatOrchestrator.js';
import {
  createSession,
  decryptSecret,
  encryptSecret,
  hashCsrfToken,
  hashSessionToken,
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
const externalMcp = new ExternalMcpAdapter(config);
const skillAdapter = new SkillAdapter(config);
const chatOrchestrator = new ChatOrchestrator(config, repo, router, externalMcp, skillAdapter);

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

async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE_NAME];
  const signedSession = verifySessionToken(token, config.APP_SESSION_SECRET);
  if (!token || !signedSession) {
    throw new LevhubError('AUTH_REQUIRED', 'Sesi tidak valid atau telah berakhir. Silakan login kembali.', 401);
  }

  const session = await repo.getActiveSession(hashSessionToken(token));
  if (!session) {
    throw new LevhubError('AUTH_REQUIRED', 'Sesi tidak valid atau telah berakhir. Silakan login kembali.', 401);
  }

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    const headerCsrf = req.headers['x-levhub-csrf'];
    if (typeof headerCsrf !== 'string' || hashCsrfToken(headerCsrf) !== session.csrf_token_hash) {
      throw new LevhubError('AUTH_REQUIRED', 'Validasi CSRF gagal. Muat ulang halaman dan coba lagi.', 403);
    }
    const clientIp = req.ip || 'owner';
    if (!checkMutationRateLimit(clientIp)) {
      throw new LevhubError('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar lagi.', 429, true);
    }
  }

  reply.header('X-Correlation-Id', crypto.randomUUID());
  return { expiresAt: Date.parse(session.expires_at) };
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

app.get('/api/health', async () => {
  const [routerHealth, dbHealth] = await Promise.all([router.healthCheck(), repo.healthCheck()]);
  const overallOk = routerHealth.ok && dbHealth.ok;
  return {
    app: 'LEVHUB',
    status: overallOk ? 'healthy' : 'degraded',
    checkedAt: new Date().toISOString(),
    dependencies: { router: routerHealth, supabase: dbHealth },
  };
});

app.post('/api/auth/login', async (req, reply) => {
  const clientKey = req.ip || 'owner';
  const rate = checkLoginRateLimit(clientKey);
  if (!rate.allowed) {
    reply.header('Retry-After', String(rate.retryAfterSec));
    throw new LevhubError('RATE_LIMITED', `Terlalu banyak percobaan login gagal. Coba lagi dalam ${rate.retryAfterSec} detik.`, 429, true);
  }
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Password wajib diisi.', 400);
  const ok = verifyPasswordHash(parsed.data.password, config.APP_PASSWORD_HASH);
  if (!ok) {
    recordLoginFailure(clientKey);
    await repo.recordAuditEvent('login_failure', { ip: clientKey });
    throw new LevhubError('AUTH_REQUIRED', 'Kredensial tidak valid.', 401);
  }
  clearLoginFailures(clientKey);
  const { token, record } = createSession(config.APP_SESSION_SECRET, config.SESSION_TTL_HOURS);
  await repo.createSession(hashSessionToken(token), record.csrfToken, new Date(record.expiresAt).toISOString());
  await repo.recordAuditEvent('login_success', { ip: clientKey });
  reply.setCookie(SESSION_COOKIE_NAME, token, { httpOnly: true, secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: config.SESSION_TTL_HOURS * 3600 });
  reply.setCookie(CSRF_COOKIE_NAME, record.csrfToken, { httpOnly: false, secure: config.COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: config.SESSION_TTL_HOURS * 3600 });
  return { ok: true, workspaceName: config.WORKSPACE_NAME, csrfToken: record.csrfToken };
});

app.get('/api/auth/me', async (req) => {
  const token = req.cookies[SESSION_COOKIE_NAME];
  const signedSession = verifySessionToken(token, config.APP_SESSION_SECRET);
  if (!token || !signedSession) return { authenticated: false };
  const session = await repo.getActiveSession(hashSessionToken(token));
  if (!session) return { authenticated: false };
  return { authenticated: true, workspaceName: config.WORKSPACE_NAME, csrfToken: req.cookies[CSRF_COOKIE_NAME] ?? null, expiresAt: session.expires_at };
});

app.post('/api/auth/logout', async (req, reply) => {
  const token = req.cookies[SESSION_COOKIE_NAME];
  if (token && verifySessionToken(token, config.APP_SESSION_SECRET)) await repo.revokeSession(hashSessionToken(token));
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  return { ok: true };
});

app.post('/api/auth/logout-all', async (req, reply) => {
  await requireSession(req, reply);
  await repo.revokeAllSessions();
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
  return { ok: true };
});

app.get('/api/models', async (req, reply) => { await requireSession(req, reply); return await router.listModels(false); });
app.post('/api/models/refresh', async (req, reply) => { await requireSession(req, reply); const catalog = await router.listModels(true); await repo.recordAuditEvent('model_catalog_refresh', { count: catalog.items.length }); return catalog; });

const CHAT_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/plain', 'text/markdown', 'text/csv', 'application/json',
  'application/zip', 'application/octet-stream',
]);

app.post('/api/chat/attachments/sign', async (req, reply) => {
  await requireSession(req, reply);
  const parsed = z.object({
    name: z.string().min(1).max(180),
    mimeType: z.string().min(1).max(160),
    size: z.number().int().positive().max(config.MAX_CHAT_ATTACHMENT_BYTES),
  }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Metadata file tidak valid atau ukuran file melebihi 100 MB.', 400);
  const mimeType = parsed.data.mimeType.toLowerCase().split(';')[0].trim();
  if (!CHAT_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new LevhubError('UNSUPPORTED_CAPABILITY', 'Format file ini belum didukung. Gunakan foto, video MP4/WebM, PDF, DOCX, XLSX, CSV, JSON, atau TXT.', 415);
  }
  const safeName = parsed.data.name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'attachment';
  const path = `${config.WORKSPACE_ID}/${crypto.randomUUID()}-${safeName}`;
  const upload = await repo.createChatAttachmentUpload(path);
  return { ...upload, mimeType, size: parsed.data.size, name: parsed.data.name };
});

app.post('/api/chat/attachments/access', async (req, reply) => {
  await requireSession(req, reply);
  const parsed = z.object({ path: z.string().min(1).max(500) }).safeParse(req.body);
  if (!parsed.success || !parsed.data.path.startsWith(`${config.WORKSPACE_ID}/`)) {
    throw new LevhubError('INVALID_INPUT', 'Path lampiran tidak valid.', 400);
  }
  return { signedUrl: await repo.createChatAttachmentReadUrl(parsed.data.path) };
});

app.post('/api/chat', async (req, reply) => {
  await requireSession(req, reply);
  const parsed = z.object({ conversationId: z.string().uuid().optional(), modelId: z.string().min(1), message: z.string().min(1).max(100_000) }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Permintaan chat memerlukan modelId dan pesan yang valid.', 400);
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const abortController = new AbortController();
  req.raw.socket.once('close', () => abortController.abort());
  try {
    await chatOrchestrator.handleChatTurn({ conversationId: parsed.data.conversationId, modelId: parsed.data.modelId, message: parsed.data.message, signal: abortController.signal, emit: (event) => { reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); } });
  } catch (err) {
    const norm = normalizeUnknownError(err);
    reply.raw.write(`event: turn.error\ndata: ${JSON.stringify(norm.toEnvelope())}\n\n`);
  } finally { reply.raw.end(); }
});

app.post('/api/chat/tool-calls/:id/decision', async (req, reply) => {
  await requireSession(req, reply);
  const { id } = req.params as { id: string };
  const parsed = z.object({ approved: z.boolean() }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Field approved (boolean) wajib diisi.', 400);
  return await chatOrchestrator.decideToolCall(id, parsed.data.approved);
});

app.get('/api/conversations', async (req, reply) => { await requireSession(req, reply); const q = req.query as { cursor?: string; limit?: string; search?: string }; const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100); return await repo.listConversations(limit, q.cursor, q.search); });
app.post('/api/conversations', async (req, reply) => { await requireSession(req, reply); const parsed = z.object({ title: z.string().min(1).max(160).optional(), modelId: z.string().nullable().optional() }).safeParse(req.body ?? {}); if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Data percakapan tidak valid.', 400); return await repo.createConversation(parsed.data.title || 'Percakapan Baru', parsed.data.modelId ?? null); });
app.get('/api/conversations/:id', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; return await repo.getConversation(id); });
app.patch('/api/conversations/:id', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; const parsed = z.object({ title: z.string().min(1).max(160) }).safeParse(req.body); if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Judul percakapan tidak valid.', 400); return await repo.renameConversation(id, parsed.data.title.trim()); });
app.delete('/api/conversations/:id', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; await repo.deleteConversation(id); await repo.recordAuditEvent('conversation_deleted', { conversationId: id }); return { deleted: true }; });
app.get('/api/conversations/:id/export', async (req, reply) => {
  await requireSession(req, reply);
  const { id } = req.params as { id: string };
  const format = ((req.query as { format?: string }).format || 'markdown').toLowerCase();
  const data = await repo.getConversation(id);
  if (format === 'json') { reply.header('Content-Disposition', `attachment; filename="levhub-${id}.json"`); return data; }
  const lines = [`# ${data.conversation.title}`, `Model: ${data.conversation.model_id ?? '-'}`, ''];
  for (const m of data.messages) { lines.push(`## ${m.role.toUpperCase()} (${m.created_at})`); lines.push(typeof m.content.text === 'string' ? m.content.text : JSON.stringify(m.content, null, 2)); lines.push(''); }
  reply.type('text/markdown; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="levhub-${id}.md"`);
  return lines.join('\n');
});

app.get('/api/mcp', async (req, reply) => { await requireSession(req, reply); const [saved, runtimeServers] = await Promise.all([repo.isConfigured() ? repo.listIntegrations('mcp') : Promise.resolve([]), Promise.resolve([])]); return { runtimeServers, externalServers: saved.map(maskIntegration) }; });

type MarketplaceEntry = { id: string; name: string; description: string; version: string; source: string; category: string; repositoryUrl: string | null; websiteUrl: string | null; transport: string[]; auth: string[]; install: unknown; verified: boolean };
function inferMcpCategory(value: string): string {
  const s = value.toLowerCase();
  if (/github|gitlab|git|code|developer|sentry/.test(s)) return 'Developer Tools';
  if (/postgres|supabase|mysql|mongo|database|sql|redis/.test(s)) return 'Database';
  if (/browser|search|fetch|crawl|firecrawl|puppeteer|playwright/.test(s)) return 'Browser & Search';
  if (/cloud|aws|azure|gcp|vercel|cloudflare|docker|kubernetes|railway/.test(s)) return 'Cloud & DevOps';
  if (/slack|discord|telegram|email|notion|linear|asana/.test(s)) return 'Productivity & Communication';
  if (/file|storage|drive|dropbox|s3/.test(s)) return 'Files & Storage';
  if (/security|auth|secret|vault/.test(s)) return 'Security';
  if (/figma|design|image|video|media|canva/.test(s)) return 'Design & Media';
  if (/ai|agent|model|llm|openai|gemini/.test(s)) return 'AI & Agents';
  return 'Other';
}
function normalizeRegistryEntry(raw: any): MarketplaceEntry | null {
  const s = raw?.server ?? raw;
  if (!s || typeof s.name !== 'string') return null;
  const packages = Array.isArray(s.packages) ? s.packages : [];
  const remotes = Array.isArray(s.remotes) ? s.remotes : [];
  const transports = [...new Set([...(packages.length ? ['stdio'] : []), ...remotes.map((r: any) => String(r?.type || 'http').toLowerCase())])];
  const auth = [...new Set([...(packages.some((p: any) => (p.environmentVariables || []).length) ? ['Environment Variables'] : []), ...(remotes.some((r: any) => (r.headers || []).length) ? ['HTTP Headers / Token'] : []), ...(remotes.length ? ['Remote Endpoint'] : [])])];
  const meta = raw?._meta?.['io.modelcontextprotocol.registry/official'];
  return { id: 'official:' + s.name, name: String(s.title || s.name), description: String(s.description || 'Official MCP Registry listing.'), version: String(s.version || 'unknown'), source: 'Official MCP Registry', category: inferMcpCategory([s.name, s.description, s.title].filter(Boolean).join(' ')), repositoryUrl: typeof s.repository?.url === 'string' ? s.repository.url : null, websiteUrl: typeof s.websiteUrl === 'string' ? s.websiteUrl : null, transport: transports, auth, install: { packages, remotes }, verified: meta?.status === 'active' && meta?.isLatest === true };
}


app.get('/api/mcp/marketplace', async (req, reply) => {
  await requireSession(req, reply);
  const q = req.query as { q?: string; category?: string; provider?: string; limit?: string; cursor?: string; sort?: string };
  const query = String(q.q || '').trim().slice(0, 100);
  const category = String(q.category || 'All');
  const provider = String(q.provider || 'all').toLowerCase();
  const sort = ['quality', 'stars', 'downloads', 'new'].includes(String(q.sort)) ? String(q.sort) : 'quality';
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 50);
  const tasks: Array<Promise<{ items: MarketplaceEntry[]; total: number; nextCursor: string | null }>> = [];

  if (provider === 'all' || provider === 'hosted') tasks.push((async () => {
    const url = new URL('https://api.hostedmcp.org/v1/servers');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', sort);
    if (query) url.searchParams.set('q', query);
    if (category !== 'All') url.searchParams.set('category', category);
    if (q.cursor) url.searchParams.set('cursor', q.cursor);
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HostedMCP catalog unavailable');
    const data: any = await res.json();
    const rows = Array.isArray(data.items) ? data.items : [];
    const items = rows.map((s: any) => ({
      id: 'hosted:' + String(s.owner && s.name ? `${s.owner}/${s.name}` : (s.slug || s.id || s.name || s.title)),
      name: String(s.title || s.name || s.slug || 'Unknown MCP'),
      description: String(s.description || s.summary || ''),
      version: String(s.version || s.latestVersion || '—'),
      source: 'Catalog',
      category: String(s.category || inferMcpCategory([s.name, s.description, s.summary, s.tags].flat().join(' '))),
      repositoryUrl: typeof s.repo === 'string' ? s.repo : (typeof s.repository === 'string' ? s.repository : s.repository?.url || s.repositoryUrl || null),
      websiteUrl: s.homepage || s.url || s.website || null,
      transport: Array.isArray(s.transports) ? s.transports : (s.transport ? [String(s.transport)] : []),
      auth: Array.isArray(s.auth) ? s.auth : (typeof s.auth === 'string' ? [s.auth] : (s.authType ? [String(s.authType)] : [])),
      install: s,
      verified: Boolean(s.verified || s.checks?.verified || s.checks?.passed),
      popularity: { stars: Number(s.stars || s.githubStars || 0), downloads: Number(s.downloads30d || s.weeklyDownloads || s.downloads || 0) },
    } as MarketplaceEntry & { popularity: { stars: number; downloads: number } }));
    return { items, total: Number(data.total || items.length), nextCursor: data.nextCursor || null };
  })());

  if (provider === 'all' || provider === 'official') tasks.push((async () => {
    const url = new URL('https://registry.modelcontextprotocol.io/v0.1/servers');
    url.searchParams.set('limit', '100'); url.searchParams.set('version', 'latest');
    if (query.length >= 3) url.searchParams.set('search', query);
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Official Registry unavailable');
    const data: any = await res.json();
    const items = (Array.isArray(data.servers) ? data.servers : []).map(normalizeRegistryEntry).filter(Boolean) as MarketplaceEntry[];
    return { items, total: items.length, nextCursor: null };
  })());

  if (provider === 'all' || provider === 'github') tasks.push((async () => {
    const url = new URL('https://api.github.com/search/repositories');
    url.searchParams.set('q', (query || 'mcp server') + ' in:name,description,readme'); url.searchParams.set('sort', 'stars'); url.searchParams.set('per_page', '30');
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LEVHUB-MCP-Marketplace' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('GitHub discovery unavailable');
    const data: any = await res.json();
    const items = (data.items || []).map((s: any) => ({
      id: 'github:' + s.full_name, name: s.full_name, description: String(s.description || 'Community MCP server repository.'),
      version: '★ ' + Number(s.stargazers_count || 0).toLocaleString('en-US'), source: 'Catalog',
      category: inferMcpCategory(s.full_name + ' ' + (s.description || '')), repositoryUrl: s.html_url || null,
      websiteUrl: s.homepage || null, transport: [], auth: [], install: { fullName: s.full_name, defaultBranch: s.default_branch },
      verified: false, popularity: { stars: Number(s.stargazers_count || 0), downloads: 0 },
    } as MarketplaceEntry & { popularity: { stars: number; downloads: number } }));
    return { items, total: Number(data.total_count || items.length), nextCursor: null };
  })());

  const settled = await Promise.allSettled(tasks);
  const successful = settled.filter((x): x is PromiseFulfilledResult<{ items: MarketplaceEntry[]; total: number; nextCursor: string | null }> => x.status === 'fulfilled').map(x => x.value);
  const failed = settled.length - successful.length;
  const entries = successful.flatMap(x => x.items);
  const unique = Array.from(new Map(entries.map(item => [item.id, item])).values());
  const filtered = unique.filter(item => category === 'All' || item.category.toLowerCase() === category.toLowerCase());
  if (sort === 'stars') filtered.sort((a: any, b: any) => Number(b.popularity?.stars || 0) - Number(a.popularity?.stars || 0));
  else if (sort === 'downloads') filtered.sort((a: any, b: any) => Number(b.popularity?.downloads || 0) - Number(a.popularity?.downloads || 0));
  return {
    items: filtered.slice(0, limit), total: Math.max(filtered.length, successful.reduce((n, x) => n + x.total, 0)),
    nextCursor: successful.find(x => x.nextCursor)?.nextCursor || null,
    categories: ['All', ...Array.from(new Set(unique.map(item => item.category))).sort()],
    providerStatus: { loaded: successful.length, requested: tasks.length, partial: failed > 0 },
    sort, note: 'Popularity is ranked using public adoption signals, not private usage telemetry.',
  };
});

app.get('/api/mcp/marketplace/detail', async (req, reply) => {
  await requireSession(req, reply);
  const { slug: rawSlug } = req.query as { slug?: string };
  const slug = String(rawSlug || '').trim().replace(/^hosted:/, '');
  const parts = slug.split('/').filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => !/^[a-zA-Z0-9._-]{1,100}$/.test(part))) {
    throw new LevhubError('INVALID_INPUT', 'Identitas server katalog tidak valid.', 400);
  }
  const url = new URL(`https://api.hostedmcp.org/v1/servers/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`);
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new LevhubError('UPSTREAM_UNAVAILABLE', 'Detail server tidak tersedia dari katalog. Buka repositori untuk melihat petunjuk instalasi.', 502, true);
  }
  const server: any = await response.json();
  const packages = Array.isArray(server.packages) ? server.packages : [];
  const remote = packages.find((entry: any) =>
    String(entry?.transport || '').toLowerCase().includes('remote')
    || String(entry?.transport || '').toLowerCase().includes('http')
    || String(entry?.type || '').toLowerCase() === 'remote'
    || /^https:\/\//i.test(String(entry?.identifier || ''))
  ) || null;
  const endpoint = remote?.identifier || remote?.url || remote?.endpoint
    || server.remoteEndpoint || server.remoteUrl || server.endpoint || null;
  const auth = Array.isArray(server.auth) ? server.auth
    : typeof server.auth === 'string' ? [server.auth] : [];
  const envVars = Array.isArray(server.envVars) ? server.envVars
    : Array.isArray(server.environmentVariables) ? server.environmentVariables : [];
  return {
    endpoint: typeof endpoint === 'string' && /^https:\/\//i.test(endpoint) ? endpoint : null,
    transport: String(remote?.transport || remote?.type || 'streamable_http').toLowerCase().includes('sse') ? 'sse' : 'streamable_http',
    auth,
    remotes: [],
    packages,
    environmentVariables: envVars,
    repositoryUrl: typeof server.repo === 'string' ? server.repo : typeof server.repository === 'string' ? server.repository : server.repository?.url || server.repositoryUrl || null,
    install: server.install || null,
    live: server.live || null,
    checks: server.checks || null,
  };
});

app.post('/api/mcp/external', async (req, reply) => {
  await requireSession(req, reply);
  const parsed = z.object({ displayName: z.string().min(1).max(100), transport: z.enum(['streamable_http', 'sse']), endpoint: z.string().url(), authType: z.enum(['none', 'bearer', 'header']).default('none'), secret: z.string().optional(), customHeaderName: z.string().optional(), timeoutMs: z.number().int().min(2000).max(60000).optional() }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Konfigurasi MCP eksternal tidak lengkap atau tidak valid.', 400);
  await validateExternalEndpointUrl(parsed.data.endpoint, { allowHttpInDev: !config.isProd });
  const encryptedSecret = parsed.data.secret ? encryptSecret(parsed.data.secret, config.APP_ENCRYPTION_KEY) : null;
  const created = await repo.createIntegration({ kind: 'mcp', source: 'external', display_name: parsed.data.displayName.trim(), config_public: { transport: parsed.data.transport, endpoint: parsed.data.endpoint, authType: parsed.data.authType, customHeaderName: parsed.data.customHeaderName ?? null, timeoutMs: parsed.data.timeoutMs ?? 20000 }, secret_ref: encryptedSecret, status: 'configured', enabled: false });
  await repo.recordAuditEvent('mcp_connected', { integrationId: created.id, displayName: created.display_name });
  return maskIntegration(created);
});
app.post('/api/mcp/:id/test', async (req, reply) => {
  await requireSession(req, reply);
  const { id } = req.params as { id: string };
  const item = await repo.getIntegration(id); const cfg = item.config_public;
  const conn: ExternalMcpConnectionConfig = { id: item.id, endpoint: String(cfg.endpoint || ''), transport: cfg.transport === 'sse' ? 'sse' : 'streamable_http', authType: (cfg.authType as 'none' | 'bearer' | 'header') || 'none', customHeaderName: typeof cfg.customHeaderName === 'string' ? cfg.customHeaderName : undefined, secret: item.secret_ref ? decryptSecret(item.secret_ref, config.APP_ENCRYPTION_KEY) : undefined, timeoutMs: typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : undefined };
  try { const result = await externalMcp.testConnection(conn); await repo.updateIntegration(id, { status: 'healthy', last_health_check: new Date().toISOString() }); return result; }
  catch (err) { await repo.updateIntegration(id, { status: 'error', last_health_check: new Date().toISOString() }); throw err; }
});
app.post('/api/mcp/:id/enable', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; return maskIntegration(await repo.updateIntegration(id, { enabled: true })); });
app.post('/api/mcp/:id/disable', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; return maskIntegration(await repo.updateIntegration(id, { enabled: false })); });
app.delete('/api/mcp/:id', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; externalMcp.invalidateCache(id); await repo.deleteIntegration(id); await repo.recordAuditEvent('mcp_disconnected', { integrationId: id }); return { deleted: true }; });
app.get('/api/mcp/:id/tools', async (req, reply) => {
  await requireSession(req, reply);
  const { id } = req.params as { id: string };
  const item = await repo.getIntegration(id); const cfg = item.config_public;
  const conn: ExternalMcpConnectionConfig = { id: item.id, endpoint: String(cfg.endpoint || ''), transport: cfg.transport === 'sse' ? 'sse' : 'streamable_http', authType: (cfg.authType as 'none' | 'bearer' | 'header') || 'none', customHeaderName: typeof cfg.customHeaderName === 'string' ? cfg.customHeaderName : undefined, secret: item.secret_ref ? decryptSecret(item.secret_ref, config.APP_ENCRYPTION_KEY) : undefined };
  return { tools: await externalMcp.listTools(conn, true) };
});

app.get('/api/skills', async (req, reply) => { await requireSession(req, reply); const [imported, runtimeSkills] = await Promise.all([repo.isConfigured() ? repo.listSkills() : Promise.resolve([]), Promise.resolve([])]); return { runtimeSkills, importedSkills: imported }; });
app.post('/api/skills/import', async (req, reply) => {
  await requireSession(req, reply);
  if (req.isMultipart()) {
    const file = await req.file();
    if (!file) throw new LevhubError('INVALID_INPUT', 'File Skill wajib diunggah.', 400);
    const buffer = await file.toBuffer(); const filename = file.filename.toLowerCase();
    if (filename.endsWith('.md')) {
      const manifest = skillAdapter.validateMarkdownPackage(buffer.toString('utf8'));
      const saved = await repo.upsertSkill({ integration_id: null, slug: manifest.slug, version: manifest.version, description: manifest.description, source: 'imported', status: 'disabled', manifest: manifest as unknown as Record<string, unknown>, storage_path: null });
      await repo.recordAuditEvent('skill_imported', { slug: saved.slug, type: 'markdown' });
      return { skill: saved, validation: { ok: true, warnings: manifest.warnings } };
    }
    if (filename.endsWith('.zip')) {
      const { inspectZipArchiveBuffer } = await import('./security/zipValidator.js');
      const entries = inspectZipArchiveBuffer(buffer, { maxArchiveBytes: config.MAX_SKILL_ARCHIVE_BYTES });
      const slug = file.filename.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
      const saved = await repo.upsertSkill({ integration_id: null, slug, version: '1.0.0', description: `Paket ZIP tervalidasi (${entries.length} file, termasuk SKILL.md).`, source: 'imported', status: 'disabled', manifest: { files: entries, validatedAt: new Date().toISOString() }, storage_path: `${config.SUPABASE_STORAGE_BUCKET}/${slug}.zip` });
      await repo.recordAuditEvent('skill_imported', { slug: saved.slug, type: 'zip', fileCount: entries.length });
      return { skill: saved, validation: { ok: true, fileCount: entries.length, warnings: [] } };
    }
    throw new LevhubError('SKILL_INVALID', 'Hanya file .zip atau SKILL.md yang didukung.', 400);
  }
  const parsed = z.object({ markdown: z.string().min(10).max(200_000) }).safeParse(req.body);
  if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Konten SKILL.md wajib diisi.', 400);
  const manifest = skillAdapter.validateMarkdownPackage(parsed.data.markdown);
  const saved = await repo.upsertSkill({ integration_id: null, slug: manifest.slug, version: manifest.version, description: manifest.description, source: 'imported', status: 'disabled', manifest: manifest as unknown as Record<string, unknown>, storage_path: null });
  await repo.recordAuditEvent('skill_imported', { slug: saved.slug, type: 'paste' });
  return { skill: saved, validation: { ok: true, warnings: manifest.warnings } };
});
app.post('/api/skills/:id/enable', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; const updated = await repo.updateSkillStatus(id, 'enabled'); await repo.recordAuditEvent('skill_enabled', { skillId: id, slug: updated.slug }); return updated; });
app.post('/api/skills/:id/disable', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; return await repo.updateSkillStatus(id, 'disabled'); });
app.delete('/api/skills/:id', async (req, reply) => { await requireSession(req, reply); const { id } = req.params as { id: string }; await repo.deleteSkill(id); return { deleted: true }; });

app.get('/api/settings', async (req, reply) => {
  await requireSession(req, reply);
  const preferences = repo.isConfigured() ? await repo.getSettings() : {};
  return { workspaceName: config.WORKSPACE_NAME, preferences, connections: { router: { endpoint: config.ROUTER_BASE_URL, hasApiKey: Boolean(config.ROUTER_API_KEY) }, supabase: { configured: repo.isConfigured(), bucket: config.SUPABASE_STORAGE_BUCKET } }, limits: { maxToolCallsPerTurn: config.MAX_TOOL_CALLS_PER_TURN, toolExecutionTimeoutMs: config.TOOL_EXECUTION_TIMEOUT_MS, maxSkillArchiveBytes: config.MAX_SKILL_ARCHIVE_BYTES, sessionTtlHours: config.SESSION_TTL_HOURS } };
});
app.patch('/api/settings', async (req, reply) => { await requireSession(req, reply); const parsed = z.object({ key: z.enum(['general', 'mcp', 'skills']), value: z.record(z.unknown()) }).safeParse(req.body); if (!parsed.success) throw new LevhubError('INVALID_INPUT', 'Format pengaturan tidak valid.', 400); await repo.updateSetting(parsed.data.key, parsed.data.value); return { ok: true }; });
app.get('/api/audit/events', async (req, reply) => { await requireSession(req, reply); return { items: await repo.listRecentAuditEvents(40) }; });

app.listen({ port: config.PORT, host: '0.0.0.0' }).then(() => { app.log.info(`LEVHUB API berjalan di port ${config.PORT}`); });
