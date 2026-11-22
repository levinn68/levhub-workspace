interface AttemptBucket {
  failures: number;
  lockedUntil: number;
  lastAttemptAt: number;
}

const loginBuckets = new Map<string, AttemptBucket>();
const mutationBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Progressive delay and temporary lockout for failed login attempts (FR-AUTH-004 / S-001).
 */
export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
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
  const current = mutationBuckets.get(key);
  if (!current || now > current.resetAt) {
    mutationBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= maxRequests) return false;
  current.count += 1;
  return true;
}
