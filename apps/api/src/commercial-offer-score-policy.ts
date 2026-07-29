import type {
  CommercialOfferScorePolicyVersion,
  CommercialPipelineScoreBreakdown,
  ShopeeOfferRecord,
} from './repositories';
import type { ScoreService } from './score-service';

export interface CommercialOfferScorePolicy {
  readonly policyVersion: CommercialOfferScorePolicyVersion;
  score(product: ShopeeOfferRecord): CommercialPipelineScoreBreakdown;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const OFFICIAL_SCORE_CAPS = {
  commissionRate: 20,
  rating: 5,
  sales: 10_000,
  discountRate: 100,
} as const;

const OFFICIAL_SCORE_WEIGHTS = {
  commission: 35,
  rating: 25,
  sales: 20,
  discount: 20,
} as const;

export const roundCommercialScoreValue = (value: number) =>
  Number(value.toFixed(4));

export const sanitizeCommercialScoreBreakdown = (
  result: CommercialPipelineScoreBreakdown,
): CommercialPipelineScoreBreakdown => ({
  policyVersion: result.policyVersion,
  rawTotal: roundCommercialScoreValue(result.rawTotal),
  finalScore: result.finalScore,
  components: Object.fromEntries(
    Object.entries(result.components).map(([name, value]) => [
      name,
      roundCommercialScoreValue(value),
    ]),
  ),
});

export class OfficialCommercialOfferScorePolicy implements CommercialOfferScorePolicy {
  readonly policyVersion = 'official-v2' as const;

  score(product: ShopeeOfferRecord): CommercialPipelineScoreBreakdown {
    const components = {
      commissionPoints:
        (clamp(product.commissionRate, 0, OFFICIAL_SCORE_CAPS.commissionRate) /
          OFFICIAL_SCORE_CAPS.commissionRate) *
        OFFICIAL_SCORE_WEIGHTS.commission,
      ratingPoints:
        (clamp(product.rating, 0, OFFICIAL_SCORE_CAPS.rating) /
          OFFICIAL_SCORE_CAPS.rating) *
        OFFICIAL_SCORE_WEIGHTS.rating,
      salesPoints:
        (Math.log10(1 + clamp(product.sales, 0, OFFICIAL_SCORE_CAPS.sales)) /
          Math.log10(1 + OFFICIAL_SCORE_CAPS.sales)) *
        OFFICIAL_SCORE_WEIGHTS.sales,
      discountPoints:
        (clamp(product.discountRate, 0, OFFICIAL_SCORE_CAPS.discountRate) /
          OFFICIAL_SCORE_CAPS.discountRate) *
        OFFICIAL_SCORE_WEIGHTS.discount,
    };
    const rawTotal = Object.values(components).reduce(
      (total, value) => total + value,
      0,
    );
    return {
      policyVersion: this.policyVersion,
      rawTotal,
      finalScore: Math.round(rawTotal),
      components,
    };
  }
}

export class LegacyCommercialOfferScorePolicy implements CommercialOfferScorePolicy {
  readonly policyVersion = 'legacy-v1' as const;

  constructor(private readonly legacyScore: Pick<ScoreService, 'calculate'>) {}

  score(product: ShopeeOfferRecord): CommercialPipelineScoreBreakdown {
    const finalScore = this.legacyScore.calculate({
      id: product.id,
      providerProductId: product.providerProductId,
      nome: product.productName,
      preco: Number(product.price),
      desconto: product.discountRate,
      nota: product.rating,
      vendidos: product.sales,
      comissao: product.commissionRate,
      loja: product.shopName,
      offerEndsAt: null,
      unavailableAt: null,
    });
    return {
      policyVersion: this.policyVersion,
      rawTotal: finalScore,
      finalScore,
      components: {},
    };
  }
}

export class CommercialOfferScorePolicyResolver {
  private readonly legacy: LegacyCommercialOfferScorePolicy;
  private readonly official = new OfficialCommercialOfferScorePolicy();

  constructor(legacyScore: Pick<ScoreService, 'calculate'>) {
    this.legacy = new LegacyCommercialOfferScorePolicy(legacyScore);
  }

  forSource(source: ShopeeOfferRecord['source']): CommercialOfferScorePolicy {
    return source === 'OFFICIAL' ? this.official : this.legacy;
  }
}
