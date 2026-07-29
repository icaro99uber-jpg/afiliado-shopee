import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { normalizeCommercialText } from './commercial-niche-domain';
import type { CommercialNicheRecord, ShopeeOfferRecord } from './repositories';

export type CommercialNicheMatchReasonCode =
  | 'NICHE_INACTIVE'
  | 'CATEGORY_NOT_INCLUDED'
  | 'INCLUDE_KEYWORD_NOT_MATCHED'
  | 'EXCLUDE_KEYWORD_MATCHED'
  | 'PRICE_BELOW_MINIMUM'
  | 'PRICE_ABOVE_MAXIMUM'
  | 'DISCOUNT_BELOW_MINIMUM'
  | 'RATING_BELOW_MINIMUM'
  | 'SALES_BELOW_MINIMUM'
  | 'COMMISSION_BELOW_MINIMUM'
  | 'SCORE_BELOW_MINIMUM';

export type CommercialNicheMatchResult = {
  matched: boolean;
  reasonCodes: CommercialNicheMatchReasonCode[];
  normalizedEvidence: {
    titleTokenCount: number;
    categoryIntersectionCount: number;
    matchedIncludeKeywords: string[];
    matchedExcludeKeywords: string[];
    price: string;
    discountRate: number;
    rating: number;
    sales: number;
    commissionRate: number;
    finalScore: number;
  };
};

const containsTokenSequence = (
  tokens: readonly string[],
  phrase: readonly string[],
) => {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    if (phrase.every((token, index) => tokens[start + index] === token)) {
      return true;
    }
  }
  return false;
};

const normalizedCategoryId = (value: string) =>
  value.normalize('NFKC').trim().toLowerCase();

const validFinalScore = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= 100;

export class CommercialNicheMatcher {
  match({
    product,
    niche,
    finalScore,
  }: {
    product: ShopeeOfferRecord;
    niche: CommercialNicheRecord;
    finalScore: number;
  }): CommercialNicheMatchResult {
    if (product.source !== 'OFFICIAL') {
      throw new AppError(
        'Matcher comercial exige produto OFFICIAL persistido',
        'COMMERCIAL_NICHE_OFFICIAL_PRODUCT_REQUIRED',
      );
    }
    if (!validFinalScore(finalScore)) {
      throw new AppError(
        'Score final do matcher e invalido',
        'COMMERCIAL_NICHE_SCORE_INVALID',
      );
    }
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new AppError(
        'Preco persistido do produto e invalido',
        'COMMERCIAL_NICHE_PRODUCT_INVALID',
      );
    }

    const titleTokens = normalizeCommercialText(product.productName)
      .split(' ')
      .filter(Boolean);
    const productCategories = new Set(
      product.categoryIds.map(normalizedCategoryId).filter(Boolean),
    );
    const categoryIntersectionCount = niche.categoryIds.filter((categoryId) =>
      productCategories.has(normalizedCategoryId(categoryId)),
    ).length;
    const matchingKeywords = (keywords: readonly string[]) =>
      keywords.filter((keyword) =>
        containsTokenSequence(
          titleTokens,
          normalizeCommercialText(keyword).split(' ').filter(Boolean),
        ),
      );
    const matchedIncludeKeywords = matchingKeywords(niche.includeKeywords);
    const matchedExcludeKeywords = matchingKeywords(niche.excludeKeywords);
    const reasonCodes: CommercialNicheMatchReasonCode[] = [];

    if (!niche.active) reasonCodes.push('NICHE_INACTIVE');
    if (niche.categoryIds.length > 0 && categoryIntersectionCount === 0) {
      reasonCodes.push('CATEGORY_NOT_INCLUDED');
    }
    if (
      niche.includeKeywords.length > 0 &&
      matchedIncludeKeywords.length === 0
    ) {
      reasonCodes.push('INCLUDE_KEYWORD_NOT_MATCHED');
    }
    if (matchedExcludeKeywords.length > 0) {
      reasonCodes.push('EXCLUDE_KEYWORD_MATCHED');
    }
    if (niche.minPrice !== null && price < Number(niche.minPrice)) {
      reasonCodes.push('PRICE_BELOW_MINIMUM');
    }
    if (niche.maxPrice !== null && price > Number(niche.maxPrice)) {
      reasonCodes.push('PRICE_ABOVE_MAXIMUM');
    }
    if (product.discountRate < niche.minDiscountRate) {
      reasonCodes.push('DISCOUNT_BELOW_MINIMUM');
    }
    if (product.rating < niche.minRating) {
      reasonCodes.push('RATING_BELOW_MINIMUM');
    }
    if (product.sales < niche.minSales) {
      reasonCodes.push('SALES_BELOW_MINIMUM');
    }
    if (product.commissionRate < niche.minCommissionRate) {
      reasonCodes.push('COMMISSION_BELOW_MINIMUM');
    }
    if (finalScore < niche.minimumScore) {
      reasonCodes.push('SCORE_BELOW_MINIMUM');
    }

    return {
      matched: reasonCodes.length === 0,
      reasonCodes,
      normalizedEvidence: {
        titleTokenCount: titleTokens.length,
        categoryIntersectionCount,
        matchedIncludeKeywords,
        matchedExcludeKeywords,
        price: product.price,
        discountRate: product.discountRate,
        rating: product.rating,
        sales: product.sales,
        commissionRate: product.commissionRate,
        finalScore,
      },
    };
  }
}
