import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelRegistry } from '../dist/services/modelRegistry.js';
import { runProviderPanel } from '../dist/services/providerPanel.js';

const input = { models: ['router:chat', 'custom:chat'], finalModel: 'custom:chat', task: 'Bandingkan opsi', history: [] };

test('launches both providers before either opinion finishes and synthesizes after discussion', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const make = (id) => ({ id, name: id, manualModels: [{ id: 'chat', displayName: 'Chat' }], complete: async ({ model, messages }) => {
    calls.push({ id, model, text: messages.at(-1).content });
    if (calls.length <= 2) { if (calls.length === 2) release(); await gate; }
    return { content: `${id} response` };
  } });
  const result = await runProviderPanel(new ModelRegistry([make('router'), make('custom')]), { ...input, signal: AbortSignal.timeout(2000) });
  assert.deepEqual(calls.map(({ id, model }) => `${id}:${model}`), ['router:chat', 'custom:chat', 'router:chat', 'custom:chat', 'custom:chat']);
  assert.match(calls[2].text, /custom response/);
  assert.match(calls[4].text, /discussion/);
  assert.equal(result.final.model, 'custom:chat');
});

test('rejects unknown selections before any completion call', async () => {
  const registry = new ModelRegistry([]);
  await assert.rejects(runProviderPanel(registry, input), { code: 'INVALID_INPUT' });
});
