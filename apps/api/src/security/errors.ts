import crypto from 'node:crypto';
import type { ApiErrorEnvelope, LevhubErrorCode } from '../types.js';

export class LevhubError extends Error {
  public readonly code: LevhubErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly correlationId: string;

  constructor(
    code: LevhubErrorCode,
    message: string,
    statusCode = 500,
    retryable = false,
    correlationId = crypto.randomUUID(),
  ) {
    super(message);
    this.name = 'LevhubError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.correlationId = correlationId;
  }

  toEnvelope(): ApiErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        correlationId: this.correlationId,
      },
    };
  }
}

export function normalizeUnknownError(err: unknown, correlationId = crypto.randomUUID()): LevhubError {
  if (err instanceof LevhubError) return err;
  return new LevhubError(
    'INTERNAL_ERROR',
    'Terjadi kesalahan internal pada server LEVHUB.',
    500,
    false,
    correlationId,
  );
}
