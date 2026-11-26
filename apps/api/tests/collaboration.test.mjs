import assert from 'node:assert/strict';
import test from 'node:test';
import { CollaborationStageError, runCollaboration } from '../dist/services/collaboration.js';

const models = { draft: 'draft-model', review: 'review-model', final: 'final-model' };

test('passes history and prior artifacts to the selected models and preserves unknown usage', async () => {
  const requests = [];
  const result = await runCollaboration({
    models,
    task: 'Revisi budget',
    history: [{ role: 'user', content: [{ type: 'text', text: 'Budget awal' }, { type: 'image_url', image_url: { url: 'https://example.org/private' } }] }],
    complete: async (request) => {
      requests.push(request);
      return { content: `answer from ${request.model}`, usage: requests.length === 1 ? { input: 5, output: 2, total: 7 } : undefined };
    },
  });
  assert.deepEqual(requests.map(({ model }) => model), Object.values(models));
  assert.equal(requests[0].messages[1].content, 'Budget awal');
  assert.match(requests[1].messages.at(-1).content, /answer from draft-model/);
  assert.match(requests[2].messages.at(-1).content, /answer from review-model/);
  assert.equal(result.finalText, 'answer from final-model');
  assert.deepEqual(result.steps.map(({ usage }) => usage), [{ input: 5, output: 2, total: 7 }, null, null]);
});

test('keeps completed stages on upstream failure and never starts final', async () => {
  const called = [];
  await assert.rejects(runCollaboration({ models, task: 'Draft', history: [], complete: async ({ model }) => {
    called.push(model);
    if (model === models.review) throw new Error('Unavailable');
    return { content: 'draft artifact' };
  } }), (error) => error instanceof CollaborationStageError && error.stage === 'review' && error.completedSteps[0]?.output === 'draft artifact');
  assert.deepEqual(called, [models.draft, models.review]);
});

test('cancellation after draft prevents further Router calls', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(runCollaboration({ models, task: 'Draft', history: [], signal: controller.signal,
    complete: async () => { calls++; return { content: 'draft' }; },
    onStep: () => controller.abort(),
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
