import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  assertCommercialOfficialDiagnosisArgs,
  assertCommercialOfficialDiagnosisEnvironment,
  executeCommercialOfficialDiagnosis,
} from '../src/commercial-official-diagnosis';
import { CommercialOfficialDiagnosisService } from '../src/commercial-official-diagnosis-service';
import type { ShopeeOfferRecord } from '../src/repositories';

const now = new Date('2026-07-29T12:00:00.000Z');
const offer = (
  id: string,
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id,
  source: 'OFFICIAL',
  providerProductId: `external-${id}`,
  productName: `Nome sensivel ${id}`,
  shopName: `Loja sensivel ${id}`,
  categoryIds: ['external-category'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 40,
  rating: 4,
  sales: 999,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: now,
  lastSeenAt: now,
  score: null,
  scoreUpdatedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const safeEnvironment = {
  automationMode: 'preview',
  automationEnabled: false,
  schedulerEnabled: false,
  commercialSchedulerEnabled: false,
  groupSendEnabled: false,
};

describe('CommercialOfficialDiagnosisService', () => {
  it('retorna somente diagnostico sanitizado e nao oferece operacoes de escrita', async () => {
    const listOffers = vi.fn().mockResolvedValue({
      items: [
        offer('internal-1'),
        offer('internal-2', { affiliateLink: undefined }),
      ],
      total: 2,
    });
    const report = await new CommercialOfficialDiagnosisService(
      { listOffers },
      () => now,
    ).diagnose();
    expect(report).toMatchObject({
      productCount: 2,
      structuralEligibleCount: 1,
      scoreMinimum: 60,
      scoreMaximum: 60,
      scoreAverage: 60,
      scoreMedian: 60,
      eligibleAt60: 1,
      eligibleAt65: 0,
      structuralRejectionSummary: { MISSING_AFFILIATE_LINK: 1 },
      scorePolicyVersion: 'official-v2',
    });
    expect(report.products.map(({ id }) => id)).toEqual([
      'internal-1',
      'internal-2',
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('external-internal');
    expect(serialized).not.toContain('Nome sensivel');
    expect(serialized).not.toContain('Loja sensivel');
    expect(serialized).not.toContain('example.invalid');
    expect(listOffers).toHaveBeenCalledWith({
      source: 'OFFICIAL',
      page: 1,
      limit: 100,
    });
  });

  it('le todas as paginas oficiais uma unica vez', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      offer(`internal-${index}`),
    );
    const listOffers = vi
      .fn()
      .mockResolvedValueOnce({ items: firstPage, total: 101 })
      .mockResolvedValueOnce({ items: [offer('internal-100')], total: 101 });
    const report = await new CommercialOfficialDiagnosisService(
      { listOffers },
      () => now,
    ).diagnose();
    expect(report.productCount).toBe(101);
    expect(report.structuralEligibleCount).toBe(101);
    expect(listOffers).toHaveBeenNthCalledWith(2, {
      source: 'OFFICIAL',
      page: 2,
      limit: 100,
    });
    expect(listOffers).toHaveBeenCalledTimes(2);
  });
});

describe('commercial:official:diagnose', () => {
  it('aceita zero argumentos e rejeita qualquer argumento', () => {
    expect(() => assertCommercialOfficialDiagnosisArgs([])).not.toThrow();
    for (const args of [['--'], ['--json'], ['official']]) {
      expect(() => assertCommercialOfficialDiagnosisArgs(args)).toThrow(
        AppError,
      );
    }
  });

  it('exige preview, pausa, automacao e Schedulers desligados', () => {
    expect(() =>
      assertCommercialOfficialDiagnosisEnvironment({
        ...safeEnvironment,
        automationPaused: true,
      }),
    ).not.toThrow();
    for (const unsafe of [
      { automationMode: 'send' },
      { automationEnabled: true },
      { automationPaused: false },
      { schedulerEnabled: true },
      { commercialSchedulerEnabled: true },
      { groupSendEnabled: true },
    ]) {
      expect(() =>
        assertCommercialOfficialDiagnosisEnvironment({
          ...safeEnvironment,
          automationPaused: true,
          ...unsafe,
        }),
      ).toThrow(AppError);
    }
  });

  it('executa uma leitura e persiste somente o relatorio sanitizado', async () => {
    const report = {
      productCount: 0,
      structuralEligibleCount: 0,
      scoreMinimum: 0,
      scoreMaximum: 0,
      scoreAverage: 0,
      scoreMedian: 0,
      eligibleAt50: 0,
      eligibleAt55: 0,
      eligibleAt60: 0,
      eligibleAt65: 0,
      eligibleAt70: 0,
      structuralRejectionSummary: {},
      scorePolicyVersion: 'official-v2' as const,
      products: [],
    };
    const diagnose = vi.fn().mockResolvedValue(report);
    const persist = vi.fn();
    await expect(
      executeCommercialOfficialDiagnosis({
        args: [],
        environment: safeEnvironment,
        automationPaused: true,
        diagnose,
        persist,
      }),
    ).resolves.toEqual(report);
    expect(diagnose).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(report);
  });
});
