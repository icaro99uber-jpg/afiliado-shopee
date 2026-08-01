import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const MIGRATION = resolve(
  ROOT,
  'packages/database/prisma/migrations/20260729210000_campaign_promotion_mining_queue/migration.sql',
);
const SCHEMA = resolve(ROOT, 'packages/database/prisma/schema.prisma');

describe('commercial promotion candidate migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const schema = readFileSync(SCHEMA, 'utf8');

  it('cria somente a fila promocional e seus enums sem popular dados', () => {
    expect(sql).toContain('CREATE TABLE "CommercialPromotionCandidate"');
    expect(sql).toContain('CREATE TYPE "CommercialPromotionCandidateStatus"');
    expect(sql).toContain('CREATE TYPE "CommercialPromotionSignal"');
    expect(sql).not.toMatch(
      /CREATE EXTENSION|INSERT INTO|UPDATE "|DELETE FROM/i,
    );
  });

  it('preserva os status e sinais definidos no contrato', () => {
    for (const value of [
      'QUEUED',
      'COPY_READY',
      'RESERVED',
      'DISPATCHED',
      'EXPIRED',
      'BLOCKED',
      'PRICE_DROP',
      'DISCOUNT_INCREASE',
      'NEWLY_OBSERVED',
      'CURRENT_DISCOUNT',
    ]) {
      expect(sql).toContain(`'${value}'`);
      expect(schema).toContain(value);
    }
  });

  it('define unique, indices e foreign keys sem cascade destrutivo', () => {
    for (const expected of [
      'CommercialPromotionCandidate_campaignId_productId_key',
      'CommercialPromotionCandidate_campaignId_status_rankPosition_idx',
      'CommercialPromotionCandidate_campaignId_updatedAt_idx',
      'CommercialPromotionCandidate_snapshotId_idx',
      'CommercialPromotionCandidate_expiresAt_idx',
      'CommercialPromotionCandidate_dedupeUntil_idx',
    ]) {
      expect(sql).toContain(expected);
    }
    expect(sql.match(/ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it('aplica constraints de rank, score, minimumScore e priceDrop', () => {
    expect(sql).toContain('"rankPosition" > 0');
    expect(sql).toContain('"commercialScore" >= 0');
    expect(sql).toContain('"commercialScore" <= 100');
    expect(sql).toContain('"minimumScoreUsed" >= 0');
    expect(sql).toContain('"minimumScoreUsed" <= 100');
    expect(sql).toContain('"priceDropPercent" >= 0');
    expect(sql).toContain('"priceDropPercent" <= 100');
  });

  it('nao armazena links, JID, instancia, copy ou IDs externos', () => {
    expect(sql).not.toMatch(
      /affiliateLink|productLink|providerProductId|shopId|jid|sourceInstanceName|copyText|message/i,
    );
  });
});
