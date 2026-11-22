interface AttemptBucket {
  failures: number;
  lockedUntil: number;
  lastAttemptAt: number;
}

interface WindowBucket {
  count: number;
  resetAt: number;
}

const loginBuckets = new Map<string, AttemptBucket>();
const mutationBuckets = new Map<string, WindowBucket>();

/**
 * Upper bound on tracked keys. Root cause fixed here: the maps grew without
 * limit because expired entries were never evicted, leaking memory in a
 * long-running process under repeated distinct keys (e.g. spoofed IPs).
 */
const MAX_TRACKED_KEYS = 10_000;
const LOGIN_BUCKET_TTL_MS = 60 * 60 * 1000; // 1 hour after last attempt

function sweepLoginBuckets(now: number): void {
  for (const [key, bucket] of loginBuckets) {
    if (bucket.lockedUntil <= now && now - bucket.lastAttemptAt > LOGIN_BUCKET_TTL_MS) {
      loginBuckets.delete(key);
    }
  }
}

function sweepMutationBuckets(now: number): void {
  for (const [key, bucket] of mutationBuckets) {
    if (bucket.resetAt <= now) mutationBuckets.delete(key);
  }
}

function enforceCapacity(map: Map<string, unknown>): void {
  if (map.size <= MAX_TRACKED_KEYS) return;
  // Map preserves insertion order; drop the oldest quarter to bound memory.
  const target = Math.floor(MAX_TRACKED_KEYS * 0.75);
  const toDelete = map.size - target;
  let deleted = 0;
  for (const key of map.keys()) {
    map.delete(key);
    if (++deleted >= toDelete) break;
  }
}

/**
 * Progressive delay and temporary lockout for failed login attempts (FR-AUTH-004 / S-001).
 */
export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (loginBuckets.size > MAX_TRACKED_KEYS / 2) sweepLoginBuckets(now);
  const bucket = loginBuckets.get(key);
  if (!bucket) return { allowed: true, retryAfterSec: 0 };
  if (bucket.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.lockedUntil - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordLoginFailure(key: string): { retryAfterSec: number } {
  const now = Date.now();
  const prev = loginBuckets.get(key) ?? { failures: 0, lockedUntil: 0, lastAttemptAt: now };
  const failures = prev.failures + 1;
  // Progressive backoff: 0s, 2s, 5s, 15s, 60s, 300s cap
  const delays = [0, 2, 5, 15, 60, 300];
  const delaySec = delays[Math.min(failures - 1, delays.length - 1)];
  loginBuckets.set(key, {
    failures,
    lockedUntil: now + delaySec * 1000,
    lastAttemptAt: now,
  });
  enforceCapacity(loginBuckets);
  return { retryAfterSec: delaySec };
}

export function clearLoginFailures(key: string): void {
  loginBuckets.delete(key);
}

/**
 * Sliding window rate limiter for sensitive mutations.
 */
export function checkMutationRateLimit(key: string, maxRequests = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  if (mutationBuckets.size > MAX_TRACKED_KEYS / 2) sweepMutationBuckets(now);
  const current = mutationBuckets.get(key);
  if (!current || now > current.resetAt) {
    mutationBuckets.set(key, { count: 1, resetAt: now + windowMs });
    enforceCapacity(mutationBuckets);
    return true;
  }
  if (current.count >= maxRequests) return false;
  current.count += 1;
  return true;
}

/** Test/maintenance helper: clears all tracked rate limit state. */
export function __resetRateLimitState(): void {
  loginBuckets.clear();
  mutationBuckets.clear();
}

export const __testing = { sweepLoginBuckets, sweepMutationBuckets, MAX_TRACKED_KEYS };
