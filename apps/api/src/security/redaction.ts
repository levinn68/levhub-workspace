const SENSITIVE_KEY_PATTERN =
  /(pass(word|phrase)?|secret|token|api[-_]?key|auth(orization)?|cookie|session|credential|private[-_]?key|bearer|service[-_]?role)/i;

const SECRET_VALUE_PATTERN = /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/gi;

export function redactString(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, '[REDACTED]');
}

export function redactObject<T>(input: T, depth = 0): T {
  if (depth > 8 || input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return redactString(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item, depth + 1)) as unknown as T;
  }

  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactObject(val, depth + 1);
      }
    }
    return out as T;
  }

  return input;
}
