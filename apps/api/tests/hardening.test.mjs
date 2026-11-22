import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReservedIp } from '../src/security/ssrf.js';
import { validateToolArguments, evaluateToolApproval } from '../src/security/approvalPolicy.js';
import { checkLoginRateLimit, recordLoginFailure, clearLoginFailures, checkMutationRateLimit, __resetRateLimitState } from '../src/security/rateLimit.js';
import { LevhubError } from '../src/security/errors.js';

// NOTE: these tests import the compiled-independent source modules. They run
// with `node --test` after `tsc` output, or via tsx. See package.json test:api.

test('SSRF guard rejects wrapped IPv6 and private IPv4 forms', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected ${ip} to be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateOrReservedIp(ip), false, `expected ${ip} to be allowed`);
  }
  assert.equal(isPrivateOrReservedIp('2002:7f00:0001::1'), true, '6to4 wrapping 127.0.0.1 must be blocked');
  assert.equal(isPrivateOrReservedIp('64:ff9b::1'), true, 'NAT64 prefix must be blocked');
});

test('Tool argument validation rejects enum and nested violations', () => {
  const tool = {
    name: 'set_mode',
    description: '',
    source: 'external_mcp' as const,
    integrationId: 'x',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'target'],
      properties: {
        mode: { type: 'string', enum: ['fast', 'safe'] },
        target: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string' }, depth: { type: 'integer' } },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  };

  assert.doesNotThrow(() => validateToolArguments(tool, { mode: 'fast', target: { path: '/a' } }));
  assert.throws(() => validateToolArguments(tool, { mode: 'turbo', target: { path: '/a' } }), LevhubError);
  assert.throws(() => validateToolArguments(tool, { mode: 'safe', target: {} }), LevhubError);
  assert.throws(() => validateToolArguments(tool, { mode: 'safe', target: { path: '/a', depth: 1.5 } }), LevhubError);
  assert.throws(() => validateToolArguments(tool, { mode: 'safe', target: { path: '/a' }, tags: ['ok', 3] }), LevhubError);
  assert.throws(() => validateToolArguments(tool, { mode: 'safe', target: { path: '/a' }, extra: true }), LevhubError);
});

test('External MCP tools always require approval', () => {
  const evaluation = evaluateToolApproval({
    name: 'read_file',
    description: '',
    source: 'external_mcp',
    integrationId: 'x',
    parameters: {},
  });
  assert.equal(evaluation.requiresApproval, true);
});

test('Login rate limiter locks out after progressive failures and clears on success', () => {
  __resetRateLimitState();
  const key = 'test-ip';
  assert.equal(checkLoginRateLimit(key).allowed, true);
  recordLoginFailure(key);
  recordLoginFailure(key);
  const after = checkLoginRateLimit(key);
  assert.equal(after.allowed, false);
  assert.ok(after.retryAfterSec > 0);
  clearLoginFailures(key);
  assert.equal(checkLoginRateLimit(key).allowed, true);
});

test('Mutation rate limiter enforces the window limit', () => {
  __resetRateLimitState();
  const key = 'mut';
  for (let i = 0; i < 5; i++) assert.equal(checkMutationRateLimit(key, 5, 60_000), true);
  assert.equal(checkMutationRateLimit(key, 5, 60_000), false);
});
