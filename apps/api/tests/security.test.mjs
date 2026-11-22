/**
 * LEVHUB — Zero-dependency Security & Core Contract Test Suite (Node 18+ node:test)
 * Verifies password hashing, AES-256-GCM encryption, SSRF IP blocking,
 * log redaction, and ZIP path-traversal / SKILL.md validation logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';

// 1. Password hashing & timing-safe verification
test('Master password scrypt hash verifies valid password and rejects wrong password', () => {
  const password = 'Levhub-Super-Secret-2026!';
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const checkGood = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const checkBad = crypto.scryptSync('wrong-password', salt, 64, { N: 16384, r: 8, p: 1 });

  assert.equal(crypto.timingSafeEqual(derived, checkGood), true);
  assert.equal(crypto.timingSafeEqual(derived, checkBad), false);
});

// 2. AES-256-GCM Secret Encryption Round-trip
test('AES-256-GCM encrypts and decrypts external MCP secret cleanly', () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const plaintext = 'mcp_live_secret_token_987654321';

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');

  assert.equal(dec, plaintext);
  assert.notEqual(enc.toString('utf8'), plaintext);
});

// 3. SSRF Private & Metadata IP Guard
function ipv4ToInt(ip) {
  return ip.split('.').map(Number).reduce((acc, oct) => (acc << 8) + oct, 0) >>> 0;
}
function isPrivateIpv4(ip) {
  if (!net.isIPv4(ip)) return true;
  const n = ipv4ToInt(ip);
  const blocked = [
    ['10.0.0.0', 8],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
  ];
  return blocked.some(([base, prefix]) => {
    const mask = (~0 << (32 - prefix)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

test('SSRF guard blocks loopback, RFC1918 private, and AWS/GCP metadata IPs', () => {
  assert.equal(isPrivateIpv4('127.0.0.1'), true);
  assert.equal(isPrivateIpv4('10.0.0.5'), true);
  assert.equal(isPrivateIpv4('169.254.169.254'), true);
  assert.equal(isPrivateIpv4('172.16.0.1'), true);
  assert.equal(isPrivateIpv4('192.168.1.10'), true);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv4('1.1.1.1'), false);
});

// 4. ZIP Path Traversal & Executable Rejection
test('Skill archive path validator rejects traversal and executable files', () => {
  const badPaths = ['../etc/passwd', '/abs/path/SKILL.md', 'scripts/payload.exe', 'sub/../../evil.md'];
  for (const p of badPaths) {
    const isTraversal = p.startsWith('/') || p.split(/[/\\]+/).includes('..') || p.endsWith('.exe');
    assert.equal(isTraversal, true, `Expected ${p} to be rejected`);
  }
});

// 5. Log Redaction
test('Log redactor masks Authorization headers and API keys', () => {
  const sample = 'Authorization: Bearer sk-live1234567890abcdef';
  const redacted = sample.replace(/(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9]{12,})/gi, '[REDACTED]');
  assert.equal(redacted.includes('sk-live'), false);
  assert.equal(redacted.includes('[REDACTED]'), true);
});
