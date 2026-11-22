import type { AppConfig } from '../config.js';
import type { SkillRecord } from '../types.js';
import { LevhubError } from '../security/errors.js';
import {
  inspectZipArchiveBuffer,
  parseSkillMarkdown,
  type ValidatedSkillManifest,
} from '../security/zipValidator.js';

export class SkillAdapter {
  constructor(
    private readonly config: AppConfig,
  ) {}

  validateMarkdownPackage(rawMarkdown: string): ValidatedSkillManifest {
    return parseSkillMarkdown(rawMarkdown);
  }

  validateZipPackage(buffer: Buffer, extractedSkillMd: string): ValidatedSkillManifest {
    const entries = inspectZipArchiveBuffer(buffer, {
      maxArchiveBytes: this.config.MAX_SKILL_ARCHIVE_BYTES,
    });
    const manifest = parseSkillMarkdown(extractedSkillMd);
    manifest.files = entries.map((e) => ({ path: e.path, sizeBytes: e.uncompressedSize }));
    return manifest;
  }

  /**
   * Executes a Skill via the hybrid runtime adapter (FR-SKL-006).
   * Markdown instructions alone are never executed as code; they are exposed as sandboxed instruction context.
   */
  async executeSkill(skill: SkillRecord, input: Record<string, unknown>): Promise<{ output: string; mode: 'runtime' | 'instruction_context' }> {
    if (skill.status !== 'enabled') {
      throw new LevhubError('SKILL_EXECUTION_FAILED', `Skill "${skill.slug}" belum diaktifkan.`, 400);
    }


    const instructions = typeof skill.manifest?.instructionsMarkdown === 'string'
      ? skill.manifest.instructionsMarkdown
      : '';

    return {
      mode: 'instruction_context',
      output: JSON.stringify({
        skill: skill.slug,
        version: skill.version,
        trustBoundary: 'UNTRUSTED_SKILL_DATA_DO_NOT_OVERRIDE_SYSTEM_POLICY',
        instructions: instructions.slice(0, 8192),
      }),
    };
  }
}
