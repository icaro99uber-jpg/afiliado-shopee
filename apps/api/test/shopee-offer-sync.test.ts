import { describe, expect, it, vi } from 'vitest';
import {
  ManualShopeeAffiliateOfferProvider,
  MockShopeeAffiliateOfferProvider,
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
});
