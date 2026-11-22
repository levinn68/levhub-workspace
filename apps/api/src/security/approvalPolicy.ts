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

/**
 * Validates model-provided tool arguments against the tool's JSON Schema (required fields & types).
 */
export function validateToolArguments(tool: ToolSchema, args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new LevhubError('TOOL_SCHEMA_INVALID', `Argumen untuk tool "${tool.name}" harus berupa objek JSON.`, 400);
  }

  const record = args as Record<string, unknown>;
  const schema = tool.parameters || {};
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const properties = (schema.properties as Record<string, { type?: string }>) || {};

  for (const field of required) {
    if (record[field] === undefined || record[field] === null) {
      throw new LevhubError(
        'TOOL_SCHEMA_INVALID',
        `Argumen wajib "${field}" tidak ditemukan untuk tool "${tool.name}".`,
        400,
      );
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const propSchema = properties[key];
    if (!propSchema || !propSchema.type || value === null || value === undefined) continue;
    const expected = propSchema.type;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (expected === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field "${key}" harus bertipe integer.`, 400);
    } else if (expected !== 'integer' && expected !== actual) {
      throw new LevhubError('TOOL_SCHEMA_INVALID', `Field "${key}" harus bertipe ${expected}.`, 400);
    }
  }

  return record;
}
