import type { ToolSchema } from '../types.js';
import { LevhubError } from './errors.js';

const SENSITIVE_TOOL_NAME_PATTERN =
  /(delete|remove|drop|destroy|write|update|create|send|post|exec|shell|bash|run_command|filesystem|transfer|pay|approve|revoke|reset)/i;

export interface ApprovalEvaluation {
  requiresApproval: boolean;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Evaluates whether a tool call requires explicit owner approval server-side (FR-MCP-008 / FR-CHAT-003).
 * Dangerous or ambiguous tool calls default to approval-required.
 */
export function evaluateToolApproval(tool: ToolSchema): ApprovalEvaluation {
  if (tool.destructive === true) {
    return {
      requiresApproval: true,
      reason: 'Tool ditandai sebagai aksi destruktif/mutasi.',
      riskLevel: 'high',
    };
  }

  if (SENSITIVE_TOOL_NAME_PATTERN.test(tool.name)) {
    return {
      requiresApproval: true,
      reason: `Nama tool "${tool.name}" mengindikasikan operasi sensitif atau perubahan data.`,
      riskLevel: 'high',
    };
  }

  if (tool.source === 'external_mcp') {
    return {
      requiresApproval: true,
      reason: 'Eksekusi ke server MCP eksternal memerlukan konfirmasi pengguna.',
      riskLevel: 'medium',
    };
  }

  return {
    requiresApproval: false,
    reason: 'Tool baca/aman yang telah diizinkan.',
    riskLevel: 'low',
  };
}

type JsonSchemaProperty = {
  type?: string;
  enum?: unknown[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  anyOf?: JsonSchemaProperty[];
  oneOf?: JsonSchemaProperty[];
};

/**
 * Validates model-provided tool arguments against the tool's JSON Schema.
 *
 * Root cause fixed here: the previous validator only checked top-level
 * `required` and primitive types, ignoring `enum`, nested objects, arrays and
 * `anyOf`/`oneOf`. A model could pass an out-of-range enum value or a nested
 * payload that bypassed the declared contract. Validation is now recursive.
 */
export function validateToolArguments(tool: ToolSchema, args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new LevhubError('TOOL_SCHEMA_INVALID', `Argumen untuk tool "${tool.name}" harus berupa objek JSON.`, 400);
  }

  const record = args as Record<string, unknown>;
  const schema = (tool.parameters || {}) as JsonSchemaProperty & { additionalProperties?: boolean };

  validateAgainstSchema(record, schema, tool.name, '');

  if (schema.additionalProperties === false && schema.properties) {
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        throw new LevhubError(
          'TOOL_SCHEMA_INVALID',
          `Field "${key}" tidak diizinkan untuk tool "${tool.name}".`,
          400,
        );
      }
    }
  }

  return record;
}

function pathLabel(path: string): string {
  return path ? ` pada "${path}"` : '';
}

function validateAgainstSchema(
  value: unknown,
  schema: JsonSchemaProperty,
  toolName: string,
  path: string,
): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const options = (schema.anyOf ?? schema.oneOf ?? []) as JsonSchemaProperty[];
    const matched = options.some((option) => {
      try {
        validateAgainstSchema(value, option, toolName, path);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) {
      throw new LevhubError(
        'TOOL_SCHEMA_INVALID',
        `Nilai${pathLabel(path)} tidak cocok dengan skema tool "${toolName}".`,
        400,
      );
    }
    return;
  }

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe object.`, 400);
    }
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const field of required) {
      if (obj[field] === undefined || obj[field] === null) {
        throw new LevhubError(
          'TOOL_SCHEMA_INVALID',
          `Argumen wajib "${path ? `${path}.` : ''}${field}" tidak ditemukan untuk tool "${toolName}".`,
          400,
        );
      }
    }
    if (schema.properties) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (obj[key] === undefined) continue;
        validateAgainstSchema(obj[key], childSchema, toolName, path ? `${path}.${key}` : key);
      }
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe array.`, 400);
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validateAgainstSchema(item, schema.items as JsonSchemaProperty, toolName, `${path}[${index}]`),
      );
    }
    return;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!schema.enum.includes(value)) {
      throw new LevhubError(
        'TOOL_SCHEMA_INVALID',
        `Nilai${pathLabel(path)} harus salah satu dari: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}.`,
        400,
      );
    }
  }

  if (!schema.type) return;

  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe integer.`, 400);
    }
    return;
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe number.`, 400);
    }
    return;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe boolean.`, 400);
    }
    return;
  }

  if (schema.type === 'null') {
    if (value !== null) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bernilai null.`, 400);
    }
    return;
  }

  const actual = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type === 'string' && actual !== 'string') {
    throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe string.`, 400);
  }
  if (schema.type !== 'string' && schema.type !== actual) {
    throw new LevhubError('TOOL_SCHEMA_INVALID', `Field${pathLabel(path)} harus bertipe ${schema.type}.`, 400);
  }
}
