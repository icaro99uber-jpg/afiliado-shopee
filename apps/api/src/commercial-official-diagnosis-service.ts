import {
  commercialProductRejections,
  incrementCommercialRejectionSummary,
} from './commercial-offer-eligibility';
import {
  OfficialCommercialOfferScorePolicy,
  sanitizeCommercialScoreBreakdown,
} from './commercial-offer-score-policy';
import type {
  CommercialPipelineRejectionCode,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
} from './repositories';

export type CommercialOfficialDiagnosisReport = {
  productCount: number;
  structuralEligibleCount: number;
  scoreMinimum: number;
  scoreMaximum: number;
  scoreAverage: number;
  scoreMedian: number;
  eligibleAt50: number;
  eligibleAt55: number;
  eligibleAt60: number;
  eligibleAt65: number;
  eligibleAt70: number;
  structuralRejectionSummary: Partial<
    Record<CommercialPipelineRejectionCode, number>
  >;
  scorePolicyVersion: 'official-v2';
  products: Array<{
    id: string;
    structuralRejections: CommercialPipelineRejectionCode[];
    rawTotal: number;
    finalScore: number;
    components: Record<string, number>;
  }>;
};

const PAGE_SIZE = 100;

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export class CommercialOfficialDiagnosisService {
  private readonly policy = new OfficialCommercialOfferScorePolicy();

  constructor(
    private readonly offers: Pick<ShopeeOfferRepository, 'listOffers'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async listAllOfficialProducts(): Promise<ShopeeOfferRecord[]> {
    const products: ShopeeOfferRecord[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (products.length < total) {
      const result = await this.offers.listOffers({
        source: 'OFFICIAL',
        page,
        limit: PAGE_SIZE,
      });
      total = result.total;
      products.push(...result.items);
      if (result.items.length === 0) break;
      page += 1;
    }
    return products.slice(0, total);
  }

  async diagnose(): Promise<CommercialOfficialDiagnosisReport> {
    const products = await this.listAllOfficialProducts();
    const now = this.clock();
    const structuralRejectionSummary: Partial<
      Record<CommercialPipelineRejectionCode, number>
    > = {};
    const diagnosed = products.map((product) => {
      const structuralRejections = commercialProductRejections(product, now);
      structuralRejections.forEach((code) =>
        incrementCommercialRejectionSummary(structuralRejectionSummary, code),
      );
      return {
        id: product.id,
        structuralRejections,
        score: sanitizeCommercialScoreBreakdown(this.policy.score(product)),
      };
    });
    const eligibleScores = diagnosed
      .filter(({ structuralRejections }) => structuralRejections.length === 0)
      .map(({ score }) => score.finalScore);
    const distribution = {
      eligibleAt50: 0,
      eligibleAt55: 0,
      eligibleAt60: 0,
      eligibleAt65: 0,
      eligibleAt70: 0,
    };
    let scoreMinimum = Number.POSITIVE_INFINITY;
    let scoreMaximum = Number.NEGATIVE_INFINITY;
    let scoreSum = 0;
    for (const score of eligibleScores) {
      scoreMinimum = Math.min(scoreMinimum, score);
      scoreMaximum = Math.max(scoreMaximum, score);
      scoreSum += score;
      if (score >= 50) distribution.eligibleAt50 += 1;
      if (score >= 55) distribution.eligibleAt55 += 1;
      if (score >= 60) distribution.eligibleAt60 += 1;
      if (score >= 65) distribution.eligibleAt65 += 1;
      if (score >= 70) distribution.eligibleAt70 += 1;
    }
    const hasEligibleProducts = eligibleScores.length > 0;

    return {
      productCount: diagnosed.length,
      structuralEligibleCount: eligibleScores.length,
      scoreMinimum: hasEligibleProducts ? scoreMinimum : 0,
      scoreMaximum: hasEligibleProducts ? scoreMaximum : 0,
      scoreAverage: hasEligibleProducts
        ? Number((scoreSum / eligibleScores.length).toFixed(4))
        : 0,
      scoreMedian: Number(median(eligibleScores).toFixed(4)),
      ...distribution,
      structuralRejectionSummary,
      scorePolicyVersion: this.policy.policyVersion,
      products: diagnosed.map(({ id, structuralRejections, score }) => ({
        id,
        structuralRejections,
        rawTotal: score.rawTotal,
        finalScore: score.finalScore,
        components: score.components,
      })),
    };
  }
}
