import crypto from 'node:crypto';

/**
 * Signed, stateless session helpers.
 *
 * Root cause fixed here: verifySessionToken() previously returned a synthetic
 * SessionRecord with `csrfToken: ''`, `createdAt: 0`, `expiresAt: 0`. Callers
 * could mistake that for a live session with zero expiry. It now returns only
 * a signature-verified session id, and callers must resolve expiry/CSRF from
 * the database (see repo.getActiveSession).
 */

export interface SessionRecord {
  id: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

export interface VerifiedSessionId {
  id: string;
}

/**
 * Verifies a password against a stored salted scrypt hash (`scrypt$N$r$p$salt$hash`).
 * Never stores or compares plaintext passwords.
 */
export function verifyPasswordHash(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expectedHex = parts[5];

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expectedHex) {
    return false;
  }

  try {
    const derived = crypto.scryptSync(password, salt, 64, { N, r, p });
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384;
  const r = 8;
  const p = 1;
  const derived = crypto.scryptSync(password, salt, 64, { N, r, p }).toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${derived}`;
}

/**
 * Encrypts sensitive integration credentials at rest with AES-256-GCM.
 */
export function encryptSecret(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(ciphertext: string, hexKey: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || parts[0] !== 'gcm' || parts[1] !== 'v1') {
    throw new Error('Invalid encrypted secret format');
  }
  const key = Buffer.from(hexKey, 'hex');
  const iv = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const data = Buffer.from(parts[4], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function signSessionId(sessionId: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
  return `${sessionId}.${sig}`;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashCsrfToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(secret: string, ttlHours: number): { token: string; record: SessionRecord } {
  const id = crypto.randomBytes(24).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const record: SessionRecord = {
    id,
    csrfToken,
    createdAt: now,
    expiresAt: now + ttlHours * 3600 * 1000,
  };
  return { token: signSessionId(id, secret), record };
}

/**
 * Verifies only the HMAC signature of a session token.
 * Returns the embedded session id, or null when the token is absent/invalid.
 * Expiry and CSRF validity MUST be resolved from the database by the caller.
 */
export function verifySessionToken(token: string | undefined, secret: string): VerifiedSessionId | null {
  if (!token || !token.includes('.')) return null;
  const separator = token.lastIndexOf('.');
  const sessionId = token.slice(0, separator);
  const sig = token.slice(separator + 1);
  if (!sessionId || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  return { id: sessionId };
}
