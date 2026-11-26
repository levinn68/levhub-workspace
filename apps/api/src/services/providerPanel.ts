import type { ChatCompletionMessage } from '../adapters/routerAdapter.js';
import { LevhubError } from '../security/errors.js';
import type { ModelRegistry } from './modelRegistry.js';
import { runPanelDiscussion } from './panelDiscussion.js';

export async function runProviderPanel(registry: ModelRegistry, input: {
  models: string[];
  finalModel: string;
  task: ChatCompletionMessage['content'];
  history: readonly ChatCompletionMessage[];
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  if (input.models.length < 2 || input.models.length > 4 || new Set(input.models).size !== input.models.length) {
    throw new LevhubError('INVALID_INPUT', 'Pilih 2 sampai 4 model panel yang berbeda.', 400);
  }
  const { items } = await registry.catalog();
  input.signal?.throwIfAborted();
  const available = new Set(items.filter((model) => model.available).map((model) => model.id));
  if ([...input.models, input.finalModel].some((id) => !available.has(id))) {
    throw new LevhubError('INVALID_INPUT', 'Model panel atau finalizer tidak tersedia di katalog provider.', 400);
  }
  return runPanelDiscussion({ ...input, complete: registry.complete });
}
