import { describe, expect, it, vi } from 'vitest';
import {
  ManualShopeeAffiliateOfferProvider,
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
  SHOPEE_AFFILIATE_OFFICIAL_API_URL,
  type ShopeeProductOffer,
} from '@shopee-auto-affiliate-ai/providers';
import { ShopeeOfferSyncService } from '../src/shopee-offer-sync-service';
import type {
  ShopeeOfferFilters,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
} from '../src/repositories';

const logger = { info: vi.fn(), error: vi.fn() };

class MemoryOfferRepository implements ShopeeOfferRepository {
  readonly store = new Map<string, ShopeeOfferRecord>();

  async findBySourceAndProviderProductId(
    source: ShopeeProductOffer['source'],
    providerProductId: string,
  ) {
    const record = [...this.store.values()].find(
      (item) =>
        item.source === source && item.providerProductId === providerProductId,
    );
    return record ? { id: record.id } : null;
  }

  async createOffer(offer: ShopeeProductOffer) {
    const now = new Date();
    const record: ShopeeOfferRecord = {
      ...offer,
      id: `offer-${this.store.size + 1}`,
      score: null,
      scoreUpdatedAt: null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return record;
  }

  async updateOffer(id: string, offer: ShopeeProductOffer) {
    const current = this.store.get(id) as ShopeeOfferRecord;
    const updated = {
      ...current,
      ...offer,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async findOfferById(id: string) {
    return this.store.get(id) ?? null;
  }

  async listOffers(filters: ShopeeOfferFilters) {
    void filters;
    return { items: [...this.store.values()], total: this.store.size };
  }

  async listCommercialCandidates() {
    return [...this.store.values()];
  }
}

const manual = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

describe('ShopeeOfferSyncService', () => {
  it('cria, deduplica e atualiza preco e comissao sem dispatch ou fila', async () => {
    const offers = new MemoryOfferRepository();
    const first = new ShopeeOfferSyncService({
      provider: new ManualShopeeAffiliateOfferProvider([manual()]),
      offers,
      maxOffersPerSync: 5,
      logger,
    });
    expect(await first.run()).toMatchObject({ created: 1, updated: 0 });

    const second = new ShopeeOfferSyncService({
      provider: new ManualShopeeAffiliateOfferProvider([
        manual({ price: '79.90', commissionRate: 10 }),
      ]),
      offers,
      maxOffersPerSync: 5,
      logger,
    });
    expect(await second.run()).toMatchObject({ created: 0, updated: 1 });
    expect([...offers.store.values()][0]).toMatchObject({
      price: '79.90',
      commissionRate: 10,
    });
    expect(offers.store.size).toBe(1);
  });

  it('ignora oferta expirada e respeita limite baixo', async () => {
    const offers = new MemoryOfferRepository();
    const provider = new ManualShopeeAffiliateOfferProvider([
      manual({
        providerProductId: 'expired',
        offerEndsAt: '2025-01-01T00:00:00.000Z',
      }),
      manual({ providerProductId: 'active' }),
    ]);
    const service = new ShopeeOfferSyncService({
      provider,
      offers,
      maxOffersPerSync: 1,
      logger,
      now: () => new Date('2026-07-24T00:00:00.000Z'),
    });

    expect(await service.run({ limit: 100 })).toMatchObject({
      fetched: 1,
      created: 0,
      expired: 1,
    });
    expect(offers.store.size).toBe(0);
  });

  it('sincroniza mock deterministico sem acessar internet', async () => {
    const offers = new MemoryOfferRepository();
    const service = new ShopeeOfferSyncService({
      provider: new MockShopeeAffiliateOfferProvider(),
      offers,
      maxOffersPerSync: 3,
      logger,
    });
    expect(await service.run()).toMatchObject({
      source: 'mock',
      fetched: 3,
      created: 3,
    });
  });

  it('consolida rejeicoes estruturadas e campos do relatorio controlado', async () => {
    const offers = new MemoryOfferRepository();
    const provider = {
      source: 'OFFICIAL' as const,
      listProductOffers: vi.fn().mockResolvedValue({
        items: [
          {
            source: 'OFFICIAL' as const,
            providerProductId: 'official-1',
            productName: 'Produto oficial ficticio',
            shopName: 'Loja ficticia',
            categoryIds: [],
            price: '10.00',
            priceMin: '10.00',
            priceMax: '10.00',
            discountRate: 0,
            rating: 5,
            sales: 1,
            commissionRate: 1,
            imageUrl: 'https://example.invalid/image',
            productLink: 'https://example.invalid/product',
            affiliateLink: 'https://example.invalid/affiliate',
            fetchedAt: new Date('2026-07-28T12:00:00.000Z'),
          },
        ],
        page: 1,
        limit: 5,
        hasNextPage: true,
        fetchedCount: 2,
        rejected: [{ index: 1, code: 'SHOPEE_OFFICIAL_PRICE_INVALID' }],
      }),
    };
    const service = new ShopeeOfferSyncService({
      provider,
      offers,
      maxOffersPerSync: 5,
      logger,
    });
    expect(await service.run({ limit: 5 })).toMatchObject({
      fetched: 2,
      valid: 1,
      created: 1,
      updated: 0,
      rejected: 1,
      expired: 0,
      hasNextPage: true,
      affiliateLinkPresentCount: 1,
      rejectionSummary: { SHOPEE_OFFICIAL_PRICE_INVALID: 1 },
    });
  });

  it('sincroniza em memoria cinco ofertas oficiais com periodEndTime far-future', async () => {
    const affiliateLink = 'https://example.invalid/affiliate-preserved';
    const nodes = Array.from({ length: 5 }, (_, index) => ({
      productName: `Produto sanitizado ${index}`,
      itemId: 1_000 + index,
      commissionRate: '0.10',
      commission: '10.00',
      price: '100.00',
      sales: 100,
      imageUrl: 'https://example.invalid/image',
      shopName: 'Loja sanitizada',
      productLink: 'https://example.invalid/product',
      offerLink: affiliateLink,
      periodStartTime: 1_785_196_800,
      periodEndTime: 32_503_651_199,
      priceMin: '100.00',
      priceMax: '100.00',
      productCatIds: [1],
      ratingStar: '4.50',
      priceDiscountRate: 10,
      shopId: 2_000 + index,
      shopType: [1],
      sellerCommissionRate: '0.05',
      shopeeCommissionRate: '0.05',
    }));
    const provider = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      appId: 'fixture-app-id',
      secret: 'fixture-secret',
      transport: {
        execute: vi.fn().mockResolvedValue({
          data: {
            productOfferV2: {
              nodes,
              pageInfo: {
                page: 1,
                limit: 5,
                hasNextPage: false,
                scrollId: null,
              },
            },
          },
        }),
      },
      clock: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    const offers = new MemoryOfferRepository();
    const service = new ShopeeOfferSyncService({
      provider,
      offers,
      maxOffersPerSync: 5,
      logger,
    });

    const report = await service.run({ limit: 5, page: 1 });

    expect(report).toMatchObject({
      fetched: 5,
      valid: 5,
      created: 5,
      updated: 0,
      rejected: 0,
      rejectionSummary: {},
      affiliateLinkPresentCount: 5,
    });
    expect(offers.store.size).toBe(5);
    expect(
      [...offers.store.values()].every(
        (offer) => offer.affiliateLink === affiliateLink,
      ),
    ).toBe(true);
  });
});
