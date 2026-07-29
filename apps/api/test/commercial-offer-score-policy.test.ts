import { describe, expect, it, vi } from 'vitest';
import {
  CommercialOfferScorePolicyResolver,
  OfficialCommercialOfferScorePolicy,
} from '../src/commercial-offer-score-policy';
import type { ShopeeOfferRecord } from '../src/repositories';

const product = (
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id: 'internal-product-id',
  source: 'OFFICIAL',
  providerProductId: 'external-id-not-returned',
  productName: 'Produto de teste',
  shopName: 'Loja de teste',
  categoryIds: ['category'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 40,
  rating: 4,
  sales: 999,
  commissionRate: 10,
  commissionAmount: '12.34',
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: new Date('2026-07-29T12:00:00.000Z'),
  lastSeenAt: new Date('2026-07-29T12:00:00.000Z'),
  score: null,
  scoreUpdatedAt: null,
  createdAt: new Date('2026-07-29T12:00:00.000Z'),
  updatedAt: new Date('2026-07-29T12:00:00.000Z'),
  ...overrides,
});

describe('OfficialCommercialOfferScorePolicy', () => {
  const policy = new OfficialCommercialOfferScorePolicy();

  it('calcula a fixture fixa e arredonda somente o final', () => {
    const result = policy.score(product());
    expect(result.policyVersion).toBe('official-v2');
    expect(result.components.commissionPoints).toBe(17.5);
    expect(result.components.ratingPoints).toBe(20);
    expect(result.components.salesPoints).toBe(
      (Math.log10(1_000) / Math.log10(10_001)) * 20,
    );
    expect(result.components.discountPoints).toBe(8);
    expect(result.rawTotal).toBe(
      17.5 + 20 + (Math.log10(1_000) / Math.log10(10_001)) * 20 + 8,
    );
    expect(result.finalScore).toBe(60);
    expect(Object.values(result.components).reduce((a, b) => a + b, 0)).toBe(
      result.rawTotal,
    );
  });

  it('usa normalizacao logaritmica de vendas', () => {
    const low = policy.score(product({ sales: 9 })).components.salesPoints;
    const high = policy.score(product({ sales: 99 })).components.salesPoints;
    expect(low).toBe((Math.log10(10) / Math.log10(10_001)) * 20);
    expect(high).toBe((Math.log10(100) / Math.log10(10_001)) * 20);
  });

  it('limita comissao, rating, vendas e desconto nos intervalos oficiais', () => {
    expect(
      policy.score(
        product({
          commissionRate: 200,
          rating: 20,
          sales: 100_000,
          discountRate: 1_000,
        }),
      ),
    ).toMatchObject({
      rawTotal: 100,
      finalScore: 100,
      components: {
        commissionPoints: 35,
        ratingPoints: 25,
        salesPoints: 20,
        discountPoints: 20,
      },
    });
    expect(
      policy.score(
        product({
          commissionRate: -1,
          rating: -1,
          sales: -1,
          discountRate: -1,
        }),
      ),
    ).toMatchObject({
      rawTotal: 0,
      finalScore: 0,
      components: {
        commissionPoints: 0,
        ratingPoints: 0,
        salesPoints: 0,
        discountPoints: 0,
      },
    });
  });

  it('ignora nome da loja, shopType, preco e commissionAmount', () => {
    const baseline = policy.score(product());
    const changed = policy.score(
      product({
        shopName: 'Outra loja oficial ou nao',
        shopType: [1, 2, 3],
        price: '99999.99',
        commissionAmount: '99999.99',
      }),
    );
    expect(changed).toEqual(baseline);
  });
});

describe('CommercialOfferScorePolicyResolver', () => {
  it('preserva exatamente o score legado para MOCK e MANUAL', () => {
    const calculate = vi.fn().mockReturnValue(73);
    const resolver = new CommercialOfferScorePolicyResolver({ calculate });
    for (const source of ['MOCK', 'MANUAL'] as const) {
      expect(resolver.forSource(source).score(product({ source }))).toEqual({
        policyVersion: 'legacy-v1',
        rawTotal: 73,
        finalScore: 73,
        components: {},
      });
    }
    expect(calculate).toHaveBeenCalledTimes(2);
  });
});
