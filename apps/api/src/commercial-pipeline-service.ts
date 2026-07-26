import type { FastifyBaseLogger } from 'fastify';
import {
  buildShopeeAffiliateTrackingMetadata,
  toPlannedShopeeSubIds,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { CommercialCopyGenerator } from './commercial-copy-service';
import type {
  CommercialDeliveryHistoryRepository,
  CommercialPipelineRejectionCode,
  CommercialPipelineRunFilters,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
} from './repositories';
import type { ScoreService } from './score-service';

export type CommercialPipelineInput = {
  source?: 'MOCK' | 'MANUAL';
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscountRate?: number;
  minRating?: number;
  minSales?: number;
  minCommissionRate?: number;
  minimumScore?: number;
  campaign?: string;
  limitCandidates?: number;
};

type NormalizedCommercialPipelineInput = Required<
  Pick<
    CommercialPipelineInput,
    'source' | 'minimumScore' | 'campaign' | 'limitCandidates'
  >
> &
  Omit<
    CommercialPipelineInput,
    'source' | 'minimumScore' | 'campaign' | 'limitCandidates'
  >;

export type CommercialPipelineDryRunResult = {
  runId: string;
  mode: 'dry-run';
  status: 'ready';
  provider: 'mock' | 'manual';
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Partial<Record<CommercialPipelineRejectionCode, number>>;
  selectedProduct: {
    id: string;
    name: string;
    price: string;
    score: number;
    affiliateLinkPresent: true;
  };
  selectedGroup: {
    id: string;
    name: string;
    fingerprint: string;
  };
  selectionReasons: string[];
  copyPreview: string;
  plannedSubIds: string[];
  dispatchWillBeCreated: false;
  jobWillBeCreated: false;
  messageWillBeSent: false;
};

export type CommercialPipelineServiceOptions = {
  offers: ShopeeOfferRepository;
  groups: WhatsAppGroupDirectoryRepository;
  score: Pick<ScoreService, 'calculate'>;
  copy: CommercialCopyGenerator;
  runs: CommercialPipelineRunRepository;
  deliveryHistory: CommercialDeliveryHistoryRepository;
  dispatches?: Pick<WhatsAppDispatchRepository, 'findByIdWithDetails'>;
  instanceName: string;
  subIdPrefix: string;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
};

const MAXIMUM_CANDIDATES = 100;
export const COMMERCIAL_GROUP_FINGERPRINT = /^grp_[a-f0-9]{12}$/;
const HTTP_URL = /^https?:\/\//i;

const normalizeInput = (
  input: CommercialPipelineInput,
): NormalizedCommercialPipelineInput => {
  const source = input.source ?? 'MOCK';
  const minimumScore = input.minimumScore ?? 70;
  const limitCandidates = input.limitCandidates ?? 20;
  const campaign = input.campaign?.trim() || 'dry-run-local';
  const numericEntries = [
    ['minPrice', input.minPrice],
    ['maxPrice', input.maxPrice],
    ['minDiscountRate', input.minDiscountRate],
    ['minRating', input.minRating],
    ['minSales', input.minSales],
    ['minCommissionRate', input.minCommissionRate],
    ['minimumScore', minimumScore],
  ] as const;

  if (!['MOCK', 'MANUAL'].includes(source)) {
    throw new AppError('Origem comercial invalida', 'INVALID_PIPELINE_FILTERS');
  }
  if (
    numericEntries.some(
      ([, value]) =>
        value !== undefined && (!Number.isFinite(value) || value < 0),
    ) ||
    minimumScore > 100 ||
    (input.minRating !== undefined && input.minRating > 5) ||
    (input.minDiscountRate !== undefined && input.minDiscountRate > 100) ||
    (input.minCommissionRate !== undefined && input.minCommissionRate > 100) ||
    (input.minSales !== undefined && !Number.isInteger(input.minSales)) ||
    (input.minPrice !== undefined &&
      input.maxPrice !== undefined &&
      input.minPrice > input.maxPrice) ||
    !Number.isInteger(limitCandidates) ||
    limitCandidates < 1 ||
    limitCandidates > MAXIMUM_CANDIDATES ||
    campaign.length > 80 ||
    (input.categoryId !== undefined && !input.categoryId.trim())
  ) {
    throw new AppError(
      'Filtros do pipeline comercial sao invalidos',
      'INVALID_PIPELINE_FILTERS',
    );
  }

  return {
    ...input,
    source,
    minimumScore,
    campaign,
    limitCandidates,
    categoryId: input.categoryId?.trim(),
  };
};

const addReason = (
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

const rankCandidates = (
  left: { product: ShopeeOfferRecord; score: number },
  right: { product: ShopeeOfferRecord; score: number },
) =>
  right.score - left.score ||
  right.product.commissionRate - left.product.commissionRate ||
  right.product.sales - left.product.sales ||
  right.product.discountRate - left.product.discountRate ||
  right.product.rating - left.product.rating ||
  left.product.providerProductId.localeCompare(right.product.providerProductId);

export const sanitizeCommercialPipelineRun = (
  run: CommercialPipelineRunRecord,
  dispatch?: WhatsAppDispatchDetails | null,
) => ({
  id: run.id,
  mode: run.mode.toLocaleLowerCase().replace('_', '-'),
  status: run.status.toLocaleLowerCase(),
  selectedProduct: run.productId
    ? {
        id: run.productId,
        name: run.productName,
        price: run.productPrice,
        score: run.score,
        affiliateLinkPresent: Boolean(run.copyPreview),
      }
    : null,
  selectedGroup: run.groupDestinationId
    ? {
        id: run.groupDestinationId,
        name: run.groupName,
        fingerprint: run.groupFingerprint,
      }
    : null,
  candidateCount: run.candidateCount,
  eligibleCount: run.eligibleCount,
  rejectedCount: run.rejectedCount,
  rejectionSummary: run.rejectionSummary,
  selectionReasons: run.selectionReasons,
  copyPreview: run.copyPreview,
  plannedSubIds: run.plannedSubIds,
  failureCode: run.failureCode,
  confirmedAt: run.confirmedAt?.toISOString() ?? null,
  finalStatus: run.finalStatus?.toLocaleLowerCase() ?? null,
  dispatchStatus: dispatch?.status?.toLocaleLowerCase() ?? null,
  attemptCount: dispatch?.attemptCount ?? 0,
  externalMessageIdRecorded: Boolean(dispatch?.externalMessageId),
  investigationRequired: run.investigationRequired ?? false,
  createdAt: run.createdAt.toISOString(),
  completedAt: run.completedAt?.toISOString() ?? null,
  dispatchWasCreated: Boolean(run.dispatchId),
  jobWasCreated: Boolean(run.jobId),
  messageWasSent: run.finalStatus === 'SENT' || dispatch?.status === 'SENT',
  confirmationAvailable:
    run.mode === 'DRY_RUN' &&
    run.status === 'COMPLETED' &&
    !run.confirmedAt &&
    !run.dispatchId &&
    !run.jobId,
});

export class CommercialPipelineService {
  private readonly clock: () => Date;

  constructor(private readonly options: CommercialPipelineServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async dryRun(
    rawInput: CommercialPipelineInput = {},
  ): Promise<CommercialPipelineDryRunResult> {
    const input = normalizeInput(rawInput);
    const startedAt = this.clock();
    const run = await this.options.runs.create({
      mode: 'DRY_RUN',
      status: 'STARTED',
      candidateCount: 0,
      eligibleCount: 0,
      rejectedCount: 0,
      rejectionSummary: {},
      selectionReasons: [],
      plannedSubIds: [],
      createdAt: startedAt,
      completedAt: null,
    });
    let failureRecorded = false;

    const block = async (
      code:
        | 'NO_ELIGIBLE_PRODUCT'
        | 'NO_AUTHORIZED_GROUP'
        | 'MULTIPLE_AUTHORIZED_GROUPS'
        | 'PRODUCT_ALREADY_SENT',
      state: {
        candidateCount: number;
        eligibleCount: number;
        rejectedCount: number;
        rejectionSummary: Partial<
          Record<CommercialPipelineRejectionCode, number>
        >;
      },
    ): Promise<never> => {
      await this.options.runs.update(run.id, {
        status: 'BLOCKED',
        ...state,
        failureCode: code,
        completedAt: this.clock(),
      });
      failureRecorded = true;
      throw new AppError(
        {
          NO_ELIGIBLE_PRODUCT: 'Nenhum produto elegivel encontrado',
          NO_AUTHORIZED_GROUP: 'Nenhum grupo autorizado disponivel',
          MULTIPLE_AUTHORIZED_GROUPS:
            'Mais de um grupo autorizado esta disponivel',
          PRODUCT_ALREADY_SENT: 'Produtos elegiveis ja foram enviados ao grupo',
        }[code],
        code,
      );
    };

    try {
      const candidates = await this.options.offers.listCommercialCandidates({
        source: input.source,
        categoryId: input.categoryId,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        minDiscountRate: input.minDiscountRate,
        minRating: input.minRating,
        minSales: input.minSales,
        minCommissionRate: input.minCommissionRate,
        limit: input.limitCandidates,
      });
      const rejectionSummary: Partial<
        Record<CommercialPipelineRejectionCode, number>
      > = {};
      const ranked: { product: ShopeeOfferRecord; score: number }[] = [];

      for (const product of candidates) {
        const reasons = commercialProductRejections(product, startedAt);
        const score = this.options.score.calculate({
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
        if (score < input.minimumScore) reasons.push('SCORE_BELOW_MINIMUM');
        if (reasons.length > 0) {
          reasons.forEach((reason) => addReason(rejectionSummary, reason));
        } else {
          ranked.push({ product, score });
        }
      }
      ranked.sort(rankCandidates);
      const initialRejectedCount = candidates.length - ranked.length;
      if (ranked.length === 0) {
        return await block('NO_ELIGIBLE_PRODUCT', {
          candidateCount: candidates.length,
          eligibleCount: 0,
          rejectedCount: initialRejectedCount,
          rejectionSummary,
        });
      }

      const groups = (
        await this.options.groups.list(this.options.instanceName, {
          active: true,
          available: true,
        })
      ).filter(
        (group): group is WhatsAppGroupRecord =>
          group.type === 'GROUP' &&
          group.active === true &&
          group.available === true &&
          group.sourceInstanceName === this.options.instanceName &&
          COMMERCIAL_GROUP_FINGERPRINT.test(group.fingerprint),
      );
      if (groups.length === 0) {
        return await block('NO_AUTHORIZED_GROUP', {
          candidateCount: candidates.length,
          eligibleCount: ranked.length,
          rejectedCount: initialRejectedCount,
          rejectionSummary,
        });
      }
      if (groups.length > 1) {
        return await block('MULTIPLE_AUTHORIZED_GROUPS', {
          candidateCount: candidates.length,
          eligibleCount: ranked.length,
          rejectedCount: initialRejectedCount,
          rejectionSummary,
        });
      }
      const group = groups[0];
      const sentChecks = await Promise.all(
        ranked.map(({ product }) =>
          this.options.deliveryHistory.wasProductSentToGroup(
            product.id,
            group.id,
          ),
        ),
      );
      const neverSent = ranked.filter((_, index) => !sentChecks[index]);
      const alreadySentCount = ranked.length - neverSent.length;
      for (let index = 0; index < alreadySentCount; index += 1)
        addReason(rejectionSummary, 'ALREADY_SENT_TO_GROUP');
      if (neverSent.length === 0) {
        return await block('PRODUCT_ALREADY_SENT', {
          candidateCount: candidates.length,
          eligibleCount: 0,
          rejectedCount: candidates.length,
          rejectionSummary,
        });
      }

      const selected = neverSent[0];
      const affiliateLink = selected.product.affiliateLink as string;
      const copyPreview = this.options.copy.generate({
        productName: selected.product.productName,
        price: selected.product.price,
        discountRate: selected.product.discountRate,
        shopName: selected.product.shopName,
        affiliateLink,
      });
      const tracking = buildShopeeAffiliateTrackingMetadata({
        groupFingerprint: group.fingerprint,
        campaign: input.campaign,
        date: startedAt,
      });
      const plannedSubIds = toPlannedShopeeSubIds(
        this.options.subIdPrefix,
        tracking,
      );
      const selectionReasons = [
        `Maior score elegivel: ${selected.score}`,
        'Desempate deterministico por comissao, vendas, desconto, avaliacao e ID do provider',
        'Produto ainda nao enviado ao grupo autorizado',
      ];
      const rejectedCount = initialRejectedCount + alreadySentCount;

      await this.options.runs.update(run.id, {
        status: 'COMPLETED',
        productId: selected.product.id,
        groupDestinationId: group.id,
        productName: selected.product.productName,
        productPrice: selected.product.price,
        groupName: group.name,
        groupFingerprint: group.fingerprint,
        score: selected.score,
        candidateCount: candidates.length,
        eligibleCount: neverSent.length,
        rejectedCount,
        rejectionSummary,
        selectionReasons,
        copyPreview,
        plannedSubIds,
        failureCode: null,
        completedAt: this.clock(),
      });
      this.options.logger.info(
        {
          event: 'commercial-pipeline.dry-run.completed',
          runId: run.id,
          candidateCount: candidates.length,
          rejectedCount,
        },
        'Commercial pipeline dry-run completed',
      );

      return {
        runId: run.id,
        mode: 'dry-run',
        status: 'ready',
        provider: input.source.toLocaleLowerCase() as 'mock' | 'manual',
        candidateCount: candidates.length,
        eligibleCount: neverSent.length,
        rejectedCount,
        rejectionSummary,
        selectedProduct: {
          id: selected.product.id,
          name: selected.product.productName,
          price: selected.product.price,
          score: selected.score,
          affiliateLinkPresent: true,
        },
        selectedGroup: {
          id: group.id,
          name: group.name,
          fingerprint: group.fingerprint,
        },
        selectionReasons,
        copyPreview,
        plannedSubIds,
        dispatchWillBeCreated: false,
        jobWillBeCreated: false,
        messageWillBeSent: false,
      };
    } catch (error) {
      if (!failureRecorded) {
        const failureCode =
          error instanceof AppError && error.code === 'INVALID_PIPELINE_FILTERS'
            ? error.code
            : 'COMMERCIAL_PIPELINE_FAILED';
        await this.options.runs.update(run.id, {
          status: 'FAILED',
          failureCode,
          completedAt: this.clock(),
        });
        this.options.logger.error(
          {
            event: 'commercial-pipeline.dry-run.failed',
            runId: run.id,
            code: failureCode,
          },
          'Commercial pipeline dry-run failed',
        );
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Falha segura no pipeline comercial',
        'COMMERCIAL_PIPELINE_FAILED',
      );
    }
  }

  async listRuns(filters: CommercialPipelineRunFilters) {
    const result = await this.options.runs.list(filters);
    const items = await Promise.all(
      result.items.map(async (run) =>
        sanitizeCommercialPipelineRun(
          run,
          run.dispatchId && this.options.dispatches
            ? await this.options.dispatches.findByIdWithDetails(run.dispatchId)
            : null,
        ),
      ),
    );
    return {
      items,
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
    };
  }

  async findRun(id: string) {
    const run = await this.options.runs.findById(id);
    if (!run)
      throw new AppError(
        'Execucao comercial nao encontrada',
        'COMMERCIAL_PIPELINE_RUN_NOT_FOUND',
      );
    const dispatch =
      run.dispatchId && this.options.dispatches
        ? await this.options.dispatches.findByIdWithDetails(run.dispatchId)
        : null;
    return sanitizeCommercialPipelineRun(run, dispatch);
  }
}
