import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  ALLOWED_CORS_ORIGINS: z.string().default('http://localhost:3000'),
  WORKSPACE_ID: z.string().uuid().default('00000000-0000-4000-8000-000000000001'),
  WORKSPACE_NAME: z.string().min(1).default('LEVHUB Personal Workspace'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(720).default(24),

  APP_PASSWORD_HASH: z.string().default(''),
  APP_SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-in-production'),
  APP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),

  ROUTER_BASE_URL: z.string().url().default('https://router.overdriveai.my.id/v1'),
  ROUTER_API_KEY: z.string().default(''),
  ROUTER_CATALOG_TTL_MS: z.coerce.number().int().min(5000).default(60000),
  ROUTER_TIMEOUT_MS: z.coerce.number().int().min(3000).default(45000),

  OVERDRIVE_BASE_URL: z.string().default(''),
  OVERDRIVE_API_TOKEN: z.string().default(''),
  OVERDRIVE_MCP_LIST_PATH: z.string().default('/v1/mcp/servers'),
  OVERDRIVE_SKILLS_LIST_PATH: z.string().default('/v1/skills'),
  OVERDRIVE_TIMEOUT_MS: z.coerce.number().int().min(2000).default(20000),

  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('levhub-skills'),

  MAX_TOOL_CALLS_PER_TURN: z.coerce.number().int().min(1).max(20).default(6),
  TOOL_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(25000),
  MAX_TOOL_OUTPUT_BYTES: z.coerce.number().int().min(1024).max(1048576).default(65536),
  MAX_SKILL_ARCHIVE_BYTES: z.coerce.number().int().min(1024).max(52428800).default(10485760),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProd: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const isProd = parsed.NODE_ENV === 'production';
  return {
    ...parsed,
    COOKIE_SECURE: isProd ? true : parsed.COOKIE_SECURE,
    corsOrigins: parsed.ALLOWED_CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    isProd,
  };
}
