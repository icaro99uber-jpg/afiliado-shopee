import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { ManualShopeeAffiliateOfferProvider } from './manual-shopee-affiliate-offer-provider';
import { MockShopeeAffiliateOfferProvider } from './mock-shopee-affiliate-offer-provider';
import { OfficialShopeeAffiliateOfferProvider } from './official-shopee-affiliate-offer-provider';
import {
  buildShopeeAffiliateTrackingMetadata,
  toPlannedShopeeSubIds,
} from './shopee-affiliate-offers';

const manualOffer = {
  providerProductId: 'manual-001',
  productName: 'Produto ficticio',
  shopName: 'Loja ficticia',
  price: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
};

describe('Shopee affiliate offer providers', () => {
  it('mantem mock deterministico com filtros, paginacao e campos ausentes', async () => {
    const provider = new MockShopeeAffiliateOfferProvider();
    const first = await provider.listProductOffers({
      categoryId: '100001',
      minRating: 4.2,
      sort: 'price_asc',
      limit: 2,
    });
    const repeated = await provider.listProductOffers({
      categoryId: '100001',
      minRating: 4.2,
      sort: 'price_asc',
      limit: 2,
    });

    expect(first).toEqual(repeated);
    expect(first.items).toHaveLength(2);
    expect(
      first.items.some(
        (offer) => offer.providerProductId === 'mock-affiliate-000',
      ),
    ).toBe(true);
    expect(first.hasNextPage).toBe(true);
    expect(first.nextCursor).toBe('offset:2');
    expect(
      first.items.every((offer) => offer.categoryIds.includes('100001')),
    ).toBe(true);
    expect(
      first.items.every((offer) =>
        offer.productLink.includes('example.invalid'),
      ),
    ).toBe(true);
    const withMissingFields = await provider.listProductOffers({ limit: 5 });
    expect(
      withMissingFields.items.some((offer) => offer.shopId === undefined),
    ).toBe(true);
  });

  it('valida importacao manual e preserva link afiliado sem alteracao', async () => {
    const provider = new ManualShopeeAffiliateOfferProvider([manualOffer]);
    const page = await provider.listProductOffers();
    expect(page.items[0]).toMatchObject({
      source: 'MANUAL',
      price: '99.90',
      priceMin: '99.90',
      affiliateLink: manualOffer.affiliateLink,
    });
  });

  it.each([
    { ...manualOffer, affiliateLink: undefined },
    { ...manualOffer, productLink: 'file:///produto' },
    { ...manualOffer, price: '-1' },
    { ...manualOffer, productName: '' },
  ])('rejeita oferta manual incompleta ou insegura', (record) => {
    expect(() => new ManualShopeeAffiliateOfferProvider([record])).toThrow(
      AppError,
    );
  });

  it('bloqueia official incompleto sem chamar signer ou transport', async () => {
    const transport = { execute: vi.fn() };
    const signer = { sign: vi.fn() };
    const provider = new OfficialShopeeAffiliateOfferProvider({
      transport,
      signer,
    });

    await expect(provider.listProductOffers()).rejects.toMatchObject({
      code: 'SHOPEE_API_NOT_CONFIGURED',
    });
    expect(transport.execute).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('nao chama boundaries injetados mesmo com placeholders completos', async () => {
    const transport = { execute: vi.fn() };
    const signer = { sign: vi.fn() };
    const provider = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: 'https://example.invalid/open-api',
      appId: 'placeholder-app-id',
      secret: 'placeholder-secret',
      transport,
      signer,
    });

    await expect(provider.listProductOffers()).rejects.toMatchObject({
      code: 'SHOPEE_API_TRANSPORT_PENDING',
    });
    expect(transport.execute).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });

  it('prepara Sub_ids como metadados separados sem alterar URL', () => {
    const metadata = buildShopeeAffiliateTrackingMetadata({
      groupFingerprint: 'grp_Test 01',
      campaign: 'Achados Julho',
      date: new Date('2026-07-24T12:00:00.000Z'),
    });
    expect(metadata).toEqual({
      channel: 'whatsapp',
      groupFingerprint: 'grp_test-01',
      campaign: 'achados-julho',
      date: '2026-07-24',
    });
    expect(toPlannedShopeeSubIds('whatsapp', metadata)).toEqual([
      'whatsapp',
      'whatsapp',
      'grp_test-01',
      'achados-julho',
      '2026-07-24',
    ]);
  });
});
