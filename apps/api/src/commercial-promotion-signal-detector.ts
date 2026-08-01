import Decimal from 'decimal.js';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { canonicalizeCommercialDecimal } from './commercial-offer-snapshot';
import type {
  CommercialPromotionSignal,
  CommercialPromotionSnapshotRecord,
  ShopeeOfferRecord,
} from './repositories';

const NEWLY_OBSERVED_WINDOW_MS = 24 * 60 * 60 * 1_000;

const canonicalDecimal = (value: Decimal) => {
  const fixed = value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  return canonicalizeCommercialDecimal(fixed);
};

const validObservationTime = (value: Date, now: Date) =>
  Number.isFinite(value.getTime()) &&
  value <= now &&
  value.getTime() >= now.getTime() - NEWLY_OBSERVED_WINDOW_MS;

export type CommercialPromotionSignalResult = {
  signals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
};

export class CommercialPromotionSignalDetector {
  detect({
    product,
    currentSnapshot,
    previousSnapshot,
    now,
  }: {
    product: ShopeeOfferRecord;
    currentSnapshot: CommercialPromotionSnapshotRecord;
    previousSnapshot: CommercialPromotionSnapshotRecord | null;
    now: Date;
  }): CommercialPromotionSignalResult {
    const signals: CommercialPromotionSignal[] = [];
    let priceDropPercent: string | null = null;

    if (previousSnapshot) {
      const previousPrice = new Decimal(previousSnapshot.price);
      const currentPrice = new Decimal(currentSnapshot.price);
      if (
        previousPrice.greaterThan(0) &&
        previousPrice.greaterThan(currentPrice)
      ) {
        const drop = previousPrice
          .minus(currentPrice)
          .dividedBy(previousPrice)
          .times(100);
        if (drop.isNegative() || drop.greaterThan(100) || !drop.isFinite()) {
          throw new AppError(
            'Queda de preco calculada e invalida',
            'COMMERCIAL_PROMOTION_PRICE_DROP_INVALID',
          );
        }
        signals.push('PRICE_DROP');
        priceDropPercent = canonicalDecimal(drop);
      }
      if (currentSnapshot.discountRate > previousSnapshot.discountRate) {
        signals.push('DISCOUNT_INCREASE');
      }
    }

    if (
      currentSnapshot.revision === 1 &&
      previousSnapshot === null &&
      validObservationTime(product.createdAt, now) &&
      validObservationTime(currentSnapshot.capturedAt, now)
    ) {
      signals.push('NEWLY_OBSERVED');
    }
    if (product.discountRate > 0) signals.push('CURRENT_DISCOUNT');

    return { signals, priceDropPercent };
  }
}
