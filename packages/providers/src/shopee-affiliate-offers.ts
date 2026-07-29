export type ShopeeAffiliateOfferSource = 'MOCK' | 'MANUAL' | 'OFFICIAL';

export type ShopeeOfferSort =
  'relevance' | 'price_asc' | 'price_desc' | 'commission_desc' | 'sales_desc';

export type ShopeeProductOffer = {
  source: ShopeeAffiliateOfferSource;
  providerProductId: string;
  productName: string;
  shopId?: string;
  shopName: string;
  categoryIds: string[];
  price: string;
  priceMin: string;
  priceMax: string;
  discountRate: number;
  rating: number;
  sales: number;
  commissionRate: number;
  commissionAmount?: string;
  sellerCommissionRate?: number;
  shopeeCommissionRate?: number;
  shopType?: number[];
  imageUrl: string;
  productLink: string;
  affiliateLink?: string;
  offerStartsAt?: Date;
  offerEndsAt?: Date;
  fetchedAt: Date;
};

export type ShopeeProductOfferListInput = {
  keyword?: string;
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
  minCommissionRate?: number;
  minDiscountRate?: number;
  minRating?: number;
  sort?: ShopeeOfferSort;
  page?: number;
  limit?: number;
  cursor?: string;
  subIds?: string[];
};

export type ShopeeProductOfferPage = {
  items: ShopeeProductOffer[];
  page: number;
  limit: number;
  hasNextPage: boolean;
  nextCursor?: string;
  fetchedCount?: number;
  rejected?: ShopeeProductOfferRejection[];
};

export type ShopeeProductOfferRejection = {
  index: number;
  code: string;
};

export interface ShopeeAffiliateOfferProvider {
  readonly source: ShopeeAffiliateOfferSource;
  listProductOffers(
    input?: ShopeeProductOfferListInput,
  ): Promise<ShopeeProductOfferPage>;
}

export type ShopeeAffiliateTrackingMetadata = {
  channel: 'whatsapp';
  groupFingerprint: string;
  campaign: string;
  date: string;
};

const normalizeTrackingPart = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const buildShopeeAffiliateTrackingMetadata = (input: {
  groupFingerprint: string;
  campaign: string;
  date?: Date;
}): ShopeeAffiliateTrackingMetadata => ({
  channel: 'whatsapp',
  groupFingerprint: normalizeTrackingPart(input.groupFingerprint),
  campaign: normalizeTrackingPart(input.campaign),
  date: (input.date ?? new Date()).toISOString().slice(0, 10),
});

export const toPlannedShopeeSubIds = (
  prefix: string,
  metadata: ShopeeAffiliateTrackingMetadata,
) => [
  normalizeTrackingPart(prefix),
  metadata.channel,
  metadata.groupFingerprint,
  metadata.campaign,
  metadata.date,
];
