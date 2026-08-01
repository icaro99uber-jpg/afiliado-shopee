import Decimal from 'decimal.js';

import type { CommercialPromotionRankedCandidate } from './repositories';

const descendingNumber = (left: number, right: number) => right - left;

export const rankCommercialPromotionCandidates = (
  candidates: readonly CommercialPromotionRankedCandidate[],
) =>
  candidates
    .map((candidate) => ({
      candidate,
      hasPriceDrop: candidate.promotionSignals.includes('PRICE_DROP'),
      priceDrop:
        candidate.priceDropPercent === null
          ? null
          : new Decimal(candidate.priceDropPercent),
    }))
    .sort((left, right) => {
      if (left.hasPriceDrop !== right.hasPriceDrop) {
        return left.hasPriceDrop ? -1 : 1;
      }
      if (left.priceDrop !== null || right.priceDrop !== null) {
        if (left.priceDrop === null) return 1;
        if (right.priceDrop === null) return -1;
        const comparison = right.priceDrop.comparedTo(left.priceDrop);
        if (comparison !== 0) return comparison;
      }
      return (
        descendingNumber(
          left.candidate.commercialScore,
          right.candidate.commercialScore,
        ) ||
        descendingNumber(
          left.candidate.discountRate,
          right.candidate.discountRate,
        ) ||
        descendingNumber(
          left.candidate.commissionRate,
          right.candidate.commissionRate,
        ) ||
        descendingNumber(left.candidate.sales, right.candidate.sales) ||
        left.candidate.productId.localeCompare(right.candidate.productId)
      );
    })
    .map(({ candidate }) => candidate);
