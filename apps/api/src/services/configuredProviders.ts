import { z } from 'zod';
import { RouterAdapter } from '../adapters/routerAdapter.js';
import type { AppConfig } from '../config.js';
import { ModelRegistry, type ChatProvider } from './modelRegistry.js';

const customProvidersSchema = z.array(z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).refine((id) => id !== '9router'),
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }),
  apiKeyEnv: z.string().regex(/^LEVHUB_PROVIDER_[A-Z0-9_]+_KEY$/),
  discover: z.boolean().default(true),
  modelIds: z.array(z.string().trim().min(1).max(256)).max(200).default([]),
}).refine((provider) => provider.discover || provider.modelIds.length > 0)).max(16);

/** Trusted deploy-time configuration only. Never pass URLs or key references from HTTP requests. */
export function createConfiguredRegistry(config: AppConfig, env: NodeJS.ProcessEnv = process.env): ModelRegistry {
  let raw: unknown;
  try { raw = JSON.parse(env.LEVHUB_CUSTOM_PROVIDERS ?? '[]'); }
  catch { throw new Error('LEVHUB_CUSTOM_PROVIDERS must contain valid JSON.'); }
  const parsed = customProvidersSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Invalid LEVHUB_CUSTOM_PROVIDERS configuration.');
  const router = new RouterAdapter(config);
  const providers: ChatProvider[] = [{
    id: '9router', name: '9Router',
    listModels: async () => (await router.listModels()).items,
    complete: (request) => router.createChatCompletion(request),
  }];
  for (const provider of parsed.data) {
    const key = env[provider.apiKeyEnv]?.trim();
    if (!key) throw new Error(`Missing provider credential for ${provider.id}.`);
    const adapter = new RouterAdapter({ ...config, ROUTER_BASE_URL: provider.baseUrl, ROUTER_API_KEY: key });
    providers.push({
      id: provider.id, name: provider.name,
      listModels: provider.discover ? async () => (await adapter.listModels()).items : undefined,
      manualModels: provider.modelIds.map((id) => ({ id, displayName: id })),
      complete: (request) => adapter.createChatCompletion(request),
    });
  }
  return new ModelRegistry(providers);
}
