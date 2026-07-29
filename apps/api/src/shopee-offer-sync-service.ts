import type { FastifyBaseLogger } from 'fastify';
import type {
  ShopeeAffiliateOfferProvider,
  ShopeeProductOffer,
  ShopeeProductOfferListInput,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ShopeeOfferRepository } from './repositories';

export type ShopeeOfferSyncReport = {
  source: 'mock' | 'manual' | 'official';
  fetched: number;
  valid: number;
  created: number;
  updated: number;
  rejected: number;
  skipped: number;
  expired: number;
  hasNextPage: boolean;
  affiliateLinkPresentCount: number;
};

const isHttpUrl = (value: string) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const isDecimal = (value: string) => /^\d+(?:\.\d{1,4})?$/.test(value);

export const isValidShopeeProductOffer = (offer: ShopeeProductOffer): boolean =>
  Boolean(offer.providerProductId.trim()) &&
  Boolean(offer.productName.trim()) &&
  Boolean(offer.shopName.trim()) &&
  isDecimal(offer.price) &&
  isDecimal(offer.priceMin) &&
  isDecimal(offer.priceMax) &&
  Number(offer.priceMin) <= Number(offer.priceMax) &&
  offer.discountRate >= 0 &&
  offer.discountRate <= 100 &&
  offer.rating >= 0 &&
  offer.rating <= 5 &&
  Number.isInteger(offer.sales) &&
  offer.sales >= 0 &&
  offer.commissionRate >= 0 &&
  offer.commissionRate <= 100 &&
  isHttpUrl(offer.imageUrl) &&
  isHttpUrl(offer.productLink) &&
  (!offer.affiliateLink || isHttpUrl(offer.affiliateLink)) &&
  offer.fetchedAt instanceof Date &&
  !Number.isNaN(offer.fetchedAt.getTime());

export class ShopeeOfferSyncService {
  constructor(
    private readonly options: {
      provider: ShopeeAffiliateOfferProvider;
      offers: ShopeeOfferRepository;
      maxOffersPerSync: number;
      logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
      now?: () => Date;
    },
  ) {}

  async run(
    input: ShopeeProductOfferListInput = {},
  ): Promise<ShopeeOfferSyncReport> {
    const limit = Math.min(
      Math.max(input.limit ?? this.options.maxOffersPerSync, 1),
      this.options.maxOffersPerSync,
    );
    const source = this.options.provider.source.toLocaleLowerCase() as
      'mock' | 'manual' | 'official';
    const report: ShopeeOfferSyncReport = {
      source,
      fetched: 0,
      valid: 0,
      created: 0,
      updated: 0,
      rejected: 0,
      skipped: 0,
      expired: 0,
      hasNextPage: false,
      affiliateLinkPresentCount: 0,
    };

    this.options.logger.info(
      { event: 'shopee.offers.sync.started', source, limit },
      'Shopee offer sync started',
    );

    try {
      const page = await this.options.provider.listProductOffers({
        ...input,
        limit,
      });
      report.fetched = page.fetchedCount ?? page.items.length;
      report.rejected = page.rejected?.length ?? 0;
      report.hasNextPage = page.hasNextPage;
      const seen = new Set<string>();
      const now = this.options.now?.() ?? new Date();

      for (const offer of page.items.slice(0, limit)) {
        const logicalKey = `${offer.source}:${offer.providerProductId}`;
        if (!isValidShopeeProductOffer(offer) || seen.has(logicalKey)) {
          report.skipped += 1;
          report.rejected += 1;
          continue;
        }
        seen.add(logicalKey);
        report.valid += 1;
        if (offer.affiliateLink) report.affiliateLinkPresentCount += 1;
        if (offer.offerEndsAt && offer.offerEndsAt <= now) {
          report.expired += 1;
          continue;
        }

        const existing =
          await this.options.offers.findBySourceAndProviderProductId(
            offer.source,
            offer.providerProductId,
          );
        if (existing) {
          await this.options.offers.updateOffer(existing.id, offer);
          report.updated += 1;
        } else {
          await this.options.offers.createOffer(offer);
          report.created += 1;
        }
      }

      this.options.logger.info(
        { event: 'shopee.offers.sync.completed', ...report },
        'Shopee offer sync completed',
      );
      return report;
    } catch (error) {
      this.options.logger.error(
        {
          event: 'shopee.offers.sync.failed',
          source,
          code: error instanceof AppError ? error.code : 'UNKNOWN',
        },
        'Shopee offer sync failed',
      );
      throw error;
    }
  }
}
