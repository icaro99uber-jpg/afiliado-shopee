import { describe, expect, it } from 'vitest';

import {
  parseCommercialNicheCreate,
  parseCommercialNichePatch,
} from '../src/commercial-niche-domain';
import { CommercialNicheMatcher } from '../src/commercial-niche-matcher';
import type {
  CommercialNicheRecord,
  ShopeeOfferRecord,
} from '../src/repositories';

const now = new Date('2026-07-29T12:00:00.000Z');
const niche = (
  overrides: Partial<CommercialNicheRecord> = {},
): CommercialNicheRecord => ({
  id: 'niche-internal',
  ...parseCommercialNicheCreate({ name: 'Eletrônicos Úteis' }),
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const offer = (
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id: 'internal-product',
  source: 'OFFICIAL',
  providerProductId: 'external-product',
  productName: 'Fone Áudio Bluetooth Premium',
  shopName: 'Loja',
  categoryIds: ['audio'],
  shopType: [],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 12,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  score: 80,
  scoreUpdatedAt: now,
  fetchedAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('commercial niche validation', () => {
  it('normaliza slug, listas, keywords e decimais sem permitir slug mutavel', () => {
    const created = parseCommercialNicheCreate({
      name: '  Áudio & Vídeo  ',
      categoryIds: [' AUDIO ', 'audio'],
      includeKeywords: ['Fone   Áudio', 'fone áudio'],
      excludeKeywords: [],
      minPrice: '10.5000',
      maxPrice: '200.00',
    });
    expect(created).toMatchObject({
      name: 'Áudio & Vídeo',
      slug: 'audio-video',
      categoryIds: ['audio'],
      includeKeywords: ['fone audio'],
      minPrice: '10.5',
      maxPrice: '200',
    });
    expect(() =>
      parseCommercialNichePatch(niche(), { slug: 'outro' }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_NICHE_SLUG_IMMUTABLE' }),
    );
    expect(parseCommercialNichePatch(niche(), { name: 'Novo nome' })).toEqual({
      name: 'Novo nome',
    });
  });

  it('rejeita lista excessiva, campo extra e intervalo de preco invertido', () => {
    expect(() =>
      parseCommercialNicheCreate({
        name: 'Teste',
        categoryIds: Array(31).fill('x'),
      }),
    ).toThrow();
    expect(() =>
      parseCommercialNicheCreate({ name: 'Teste', regex: '.*' }),
    ).toThrow();
    expect(() =>
      parseCommercialNicheCreate({
        name: 'Teste',
        minPrice: '20',
        maxPrice: '10',
      }),
    ).toThrow();
  });
});

describe('CommercialNicheMatcher', () => {
  it('aplica categoria, frase normalizada e include ANY deterministicamente', () => {
    const subject = new CommercialNicheMatcher();
    const configured = niche({
      categoryIds: ['audio', 'celulares'],
      includeKeywords: ['fone audio', 'caixa som'],
      excludeKeywords: [],
      minPrice: '50',
      maxPrice: '150',
      minDiscountRate: 10,
      minRating: 4,
      minSales: 100,
      minCommissionRate: 5,
      minimumScore: 70,
    });
    expect(
      subject.match({ product: offer(), niche: configured, finalScore: 80 }),
    ).toEqual(
      subject.match({ product: offer(), niche: configured, finalScore: 80 }),
    );
    expect(
      subject.match({ product: offer(), niche: configured, finalScore: 80 })
        .matched,
    ).toBe(true);
  });

  it('evita substring, aceita include vazio e acumula razoes na ordem publica', () => {
    const subject = new CommercialNicheMatcher();
    expect(
      subject.match({
        product: offer({ productName: 'Smartphone premium' }),
        niche: niche({ includeKeywords: ['ar'] }),
        finalScore: 80,
      }).reasonCodes,
    ).toContain('INCLUDE_KEYWORD_NOT_MATCHED');
    expect(
      subject.match({ product: offer(), niche: niche(), finalScore: 80 })
        .matched,
    ).toBe(true);
    const result = subject.match({
      product: offer({
        categoryIds: ['outro'],
        price: '200',
        discountRate: 1,
        rating: 1,
        sales: 1,
        commissionRate: 1,
      }),
      niche: niche({
        active: false,
        categoryIds: ['audio'],
        includeKeywords: ['fone'],
        excludeKeywords: ['bluetooth'],
        maxPrice: '100',
        minDiscountRate: 10,
        minRating: 4,
        minSales: 100,
        minCommissionRate: 5,
        minimumScore: 90,
      }),
      finalScore: 20,
    });
    expect(result.reasonCodes).toEqual([
      'NICHE_INACTIVE',
      'CATEGORY_NOT_INCLUDED',
      'EXCLUDE_KEYWORD_MATCHED',
      'PRICE_ABOVE_MAXIMUM',
      'DISCOUNT_BELOW_MINIMUM',
      'RATING_BELOW_MINIMUM',
      'SALES_BELOW_MINIMUM',
      'COMMISSION_BELOW_MINIMUM',
      'SCORE_BELOW_MINIMUM',
    ]);
    expect(JSON.stringify(result.normalizedEvidence)).not.toMatch(
      /Smartphone|external-product|example\.invalid|affiliate/,
    );
  });
});
