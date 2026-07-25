import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { z } from 'zod';
import type {
  ShopeeAffiliateOfferProvider,
  ShopeeProductOffer,
  ShopeeProductOfferListInput,
} from './shopee-affiliate-offers';

const decimalSchema = z
  .union([z.string().trim(), z.number().finite().nonnegative()])
  .transform((value) => String(value).replace(',', '.'))
  .refine((value) => /^\d+(?:\.\d{1,4})?$/.test(value), {
    message: 'deve ser um decimal positivo com ate quatro casas',
  });

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'deve usar HTTP ou HTTPS');

const optionalDateSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));

export const manualShopeeOfferSchema = z
  .object({
    providerProductId: z.string().trim().min(1).max(200),
    productName: z.string().trim().min(1).max(500),
    shopId: z.string().trim().min(1).max(200).optional(),
    shopName: z.string().trim().min(1).max(300),
    categoryIds: z.array(z.string().trim().min(1).max(100)).default([]),
    price: decimalSchema,
    priceMin: decimalSchema.optional(),
    priceMax: decimalSchema.optional(),
    discountRate: z.coerce.number().finite().min(0).max(100),
    rating: z.coerce.number().finite().min(0).max(5),
    sales: z.coerce.number().int().nonnegative(),
    commissionRate: z.coerce.number().finite().min(0).max(100),
    commissionAmount: decimalSchema.optional(),
    sellerCommissionRate: z.coerce.number().finite().min(0).max(100).optional(),
    shopeeCommissionRate: z.coerce.number().finite().min(0).max(100).optional(),
    imageUrl: httpUrlSchema,
    productLink: httpUrlSchema,
    affiliateLink: httpUrlSchema,
    offerStartsAt: optionalDateSchema,
    offerEndsAt: optionalDateSchema,
  })
  .strict()
  .transform((value): ShopeeProductOffer => ({
    ...value,
    source: 'MANUAL',
    priceMin: value.priceMin ?? value.price,
    priceMax: value.priceMax ?? value.price,
    fetchedAt: new Date(),
  }));

export const parseManualShopeeOffer = (input: unknown): ShopeeProductOffer => {
  const result = manualShopeeOfferSchema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'registro'}: ${issue.message}`)
      .join('; ');
    throw new AppError(
      `Oferta manual invalida: ${message}`,
      'INVALID_MANUAL_SHOPEE_OFFER',
    );
  }
  return result.data;
};

export class ManualShopeeAffiliateOfferProvider implements ShopeeAffiliateOfferProvider {
  readonly source = 'MANUAL' as const;
  private readonly offers: ShopeeProductOffer[];

  constructor(records: unknown[] = []) {
    this.offers = records.map(parseManualShopeeOffer);
  }

  async listProductOffers(input: ShopeeProductOfferListInput = {}) {
    if (this.offers.length === 0) {
      throw new AppError(
        'Importacao manual exige um arquivo local validado',
        'SHOPEE_MANUAL_INPUT_REQUIRED',
      );
    }
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const page = Math.max(input.page ?? 1, 1);
    const start = (page - 1) * limit;
    const items = this.offers.slice(start, start + limit);
    return {
      items,
      page,
      limit,
      hasNextPage: start + items.length < this.offers.length,
    };
  }
}
