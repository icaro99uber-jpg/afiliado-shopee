import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260801120000_validated_ai_promotion_copies/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('validated AI promotion copy migration', () => {
  it('é aditiva, preserva legado e cria claims/constraints', () => {
    expect(sql).toContain('CREATE TYPE "GeneratedCopySource"');
    expect(sql).toContain("DEFAULT 'LEGACY_TEMPLATE'");
    expect(sql).toContain('CREATE TABLE "CommercialCopyGenerationAttempt"');
    expect(sql).toContain('CommercialCopyGenerationAttempt_state_check');
    expect(sql).toContain('GeneratedCopy_inputFingerprint_key');
    expect(sql).toContain(
      'CommercialCopyGenerationAttempt_inputFingerprint_key',
    );
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/iu);
    expect(sql).not.toMatch(/INSERT\s+INTO/iu);
  });
});
