/**
 * Regression tests for the hardening changes in this branch.
 *
 * IMPORTANT: this file imports the COMPILED output in `dist/`, not the
 * TypeScript sources. Node cannot execute `.ts` files directly, which is why
 * the earlier version of this test failed in CI. The `test` script runs the
 * TypeScript build first, so `dist/` is guaranteed to exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const dist = '../dist';

const { isPrivateOrReservedIp } = await import(`${dist}/security/ssrf.js`);
const { validateToolArguments, evaluateToolApproval } = await import(`${dist}/security/approvalPolicy.js`);
const {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  checkMutationRateLimit,
  __resetRateLimitState,
} = await import(`${dist}/security/rateLimit.js`);
const { LevhubError } = await import(`${dist}/security/errors.js`);

test('SSRF guard rejects private IPv4, loopback and metadata addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.16.0.1']) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected ${ip} to be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1']) {
    assert.equal(isPrivateOrReservedIp(ip), false, `expected ${ip} to be allowed`);
  }
});

test('SSRF guard rejects loopback, link-local and unique-local IPv6', () => {
  for (const ip of ['::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected ${ip} to be blocked`);
  }
  assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
});

test('SSRF guard blocks IPv4-mapped, NAT64 and 6to4 wrapping private space', () => {
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback');
  assert.equal(isPrivateOrReservedIp('64:ff9b::1'), true, 'NAT64 prefix');
  assert.equal(isPrivateOrReservedIp('2002:7f00:0001::1'), true, '6to4 wrapping 127.0.0.1');
});

test('Tool argument validation rejects enum violations', () => {
  const tool = {
    name: 'set_mode',
    description: '',
    source: 'external_mcp',
    integrationId: 'x',
    parameters: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['fast', 'safe'] },
      },
    },
  };

  assert.doesNotThrow(() => validateToolArguments(tool, { mode: 'fast' }));
  assert.throws(() => validateToolArguments(tool, { mode: 'turbo' }), LevhubError);
  assert.throws(() => validateToolArguments(tool, {}), LevhubError);
});

test('Tool argument validation rejects nested type violations', () => {
  const tool = {
    name: 'set_target',
    description: '',
    source: 'external_mcp',
    integrationId: 'x',
    parameters: {
      type: 'object',
      required: ['target'],
      properties: {
        target: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string' }, depth: { type: 'integer' } },
        },
      },
    },
  };

  assert.doesNotThrow(() => validateToolArguments(tool, { target: { path: '/a' } }));
  assert.throws(() => validateToolArguments(tool, { target: {} }), LevhubError);
  assert.throws(() => validateToolArguments(tool, { target: { path: '/a', depth: 1.5 } }), LevhubError);
});

test('Tool argument validation rejects values outside additionalProperties:false', () => {
  const tool = {
    name: 'strict_tool',
    description: '',
    source: 'external_mcp',
    integrationId: 'x',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string' } },
    },
  };

  assert.doesNotThrow(() => validateToolArguments(tool, { path: '/a' }));
  assert.throws(() => validateToolArguments(tool, { path: '/a', extra: true }), LevhubError);
});

test('Tool argument validation rejects array item type violations', () => {
  const tool = {
    name: 'tags_tool',
    description: '',
    source: 'external_mcp',
    integrationId: 'x',
    parameters: {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    },
  };

  assert.doesNotThrow(() => validateToolArguments(tool, { tags: ['a', 'b'] }));
  assert.throws(() => validateToolArguments(tool, { tags: ['a', 3] }), LevhubError);
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

test('Login rate limiter locks out after repeated failures and clears on success', () => {
  __resetRateLimitState();
  const key = 'test-ip';
  assert.equal(checkLoginRateLimit(key).allowed, true);

  recordLoginFailure(key);
  recordLoginFailure(key);
  recordLoginFailure(key);

  const after = checkLoginRateLimit(key);
  assert.equal(after.allowed, false, 'expected lockout after repeated failures');
  assert.ok(after.retryAfterSec > 0, 'expected a positive retry delay');

  clearLoginFailures(key);
  assert.equal(checkLoginRateLimit(key).allowed, true);
});

test('Mutation rate limiter enforces the window limit', () => {
  __resetRateLimitState();
  const key = 'mut';
  for (let i = 0; i < 5; i++) {
    assert.equal(checkMutationRateLimit(key, 5, 60_000), true, `request ${i + 1} should pass`);
  }
  assert.equal(checkMutationRateLimit(key, 5, 60_000), false);
});
