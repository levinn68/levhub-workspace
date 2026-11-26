import type { ChatCompletionRequest } from '../adapters/routerAdapter.js';
import type { TokenUsage } from './collaboration.js';

export type ProviderModel = { id: string; displayName: string; available?: boolean };
export type ChatProvider = {
  id: string;
  name: string;
  listModels?: () => Promise<readonly ProviderModel[]>;
  manualModels?: readonly ProviderModel[];
  complete: (request: ChatCompletionRequest) => Promise<{ content: string; usage?: TokenUsage | null }>;
};

/** Provider adapters are configured server-side. No credentials are returned by the registry. */
export class ModelRegistry {
  private readonly providers = new Map<string, ChatProvider>();

  constructor(providers: readonly ChatProvider[]) {
    for (const provider of providers) {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(provider.id) || this.providers.has(provider.id)) {
        throw new TypeError('Provider ID is invalid or duplicated.');
      }
      this.providers.set(provider.id, provider);
    }
  }

  async catalog() {
    const groups = await Promise.all([...this.providers.values()].map(async (provider) => {
      let discovered: readonly ProviderModel[] = [];
      let discoveryFailed = false;
      try { discovered = await provider.listModels?.() ?? []; }
      catch { discoveryFailed = true; }
      const unique = new Map((provider.manualModels ?? []).map((model) => [model.id, model]));
      for (const model of discovered) unique.set(model.id, model);
      const items = [...unique.values()].filter((model) => model.id.trim()).map((model) => ({
        id: `${provider.id}:${model.id}`,
        modelId: model.id,
        displayName: model.displayName,
        available: model.available !== false,
        providerId: provider.id,
        providerName: provider.name,
      }));
      return { providerId: provider.id, discoveryFailed, items };
    }));
    return { items: groups.flatMap((group) => group.items), unavailableCatalogs: groups.filter((group) => group.discoveryFailed).map((group) => group.providerId) };
  }

  /** Pass only model references selected from a server-validated catalog. */
  complete = async (request: ChatCompletionRequest) => {
    request.signal?.throwIfAborted();
    const separator = request.model.indexOf(':');
    const provider = separator > 0 ? this.providers.get(request.model.slice(0, separator)) : undefined;
    const modelId = request.model.slice(separator + 1);
    if (!provider || !modelId.trim()) throw new TypeError('Unknown provider or missing model ID.');
    return provider.complete({ ...request, model: modelId });
  };
}
