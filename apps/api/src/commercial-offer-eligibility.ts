import type {
  CommercialPipelineRejectionCode,
  ShopeeOfferRecord,
} from './repositories';

const HTTP_URL = /^https?:\/\//i;

export const incrementCommercialRejectionSummary = (
  summary: Partial<Record<CommercialPipelineRejectionCode, number>>,
  code: CommercialPipelineRejectionCode,
) => {
  summary[code] = (summary[code] ?? 0) + 1;
};

export const commercialProductRejections = (
  product: ShopeeOfferRecord,
  now: Date,
): CommercialPipelineRejectionCode[] => {
  const reasons: CommercialPipelineRejectionCode[] = [];
  if (product.unavailableAt) reasons.push('OFFER_UNAVAILABLE');
  if (product.offerEndsAt && product.offerEndsAt <= now)
    reasons.push('OFFER_EXPIRED');
  if (product.offerStartsAt && product.offerStartsAt > now)
    reasons.push('OFFER_NOT_STARTED');
  if (!product.affiliateLink) reasons.push('MISSING_AFFILIATE_LINK');
  else if (!HTTP_URL.test(product.affiliateLink))
    reasons.push('INVALID_AFFILIATE_LINK');
  if (!product.productName.trim()) reasons.push('INVALID_PRODUCT_NAME');
  if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0)
    reasons.push('INVALID_PRICE');
  if (!HTTP_URL.test(product.imageUrl)) reasons.push('INVALID_IMAGE');
  if (!product.shopName.trim()) reasons.push('INVALID_SHOP');
  if (
    !Number.isFinite(product.rating) ||
    product.rating < 0 ||
    product.rating > 5
  )
    reasons.push('INVALID_RATING');
  if (!Number.isInteger(product.sales) || product.sales < 0)
    reasons.push('INVALID_SALES');
  if (
    !Number.isFinite(product.commissionRate) ||
    product.commissionRate < 0 ||
    product.commissionRate > 100
  )
    reasons.push('INVALID_COMMISSION_RATE');
  return reasons;
};
