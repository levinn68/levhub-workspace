import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRegistry } from '../dist/services/modelRegistry.js';

test('keeps identical IDs on distinct providers and routes to their owning adapter', async () => {
  const make = (id) => ({ id, name: id, listModels: async () => [{ id: 'local:model', displayName: 'Local' }], complete: async ({ model }) => ({ content: `${id}/${model}` }) });
  const registry = new ModelRegistry([make('router'), make('custom')]);
  const { items } = await registry.catalog();
  assert.deepEqual(items.map(({ id }) => id), ['router:local:model', 'custom:local:model']);
  const result = await Promise.all(items.map(({ id }) => registry.complete({ model: id, messages: [] })));
  assert.deepEqual(result.map(({ content }) => content), ['router/local:model', 'custom/local:model']);
});

test('manual models remain listed when provider discovery fails', async () => {
  const registry = new ModelRegistry([{ id: 'custom', name: 'Custom', listModels: async () => { throw new Error('Unavailable'); }, manualModels: [{ id: 'chat', displayName: 'Chat' }], complete: async () => ({ content: 'ok' }) }]);
  const { items, unavailableCatalogs } = await registry.catalog();
  assert.equal(items[0].id, 'custom:chat');
  assert.deepEqual(unavailableCatalogs, ['custom']);
  await assert.rejects(registry.complete({ model: 'missing:chat', messages: [] }), TypeError);
});
