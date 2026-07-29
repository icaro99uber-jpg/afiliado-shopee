import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  AnalyticsRepository,
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionOwnership,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationExecutionRepository,
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationSettingsRepository,
  CommercialDeliveryHistoryRepository,
  CommercialConfirmationPersistenceInput,
  CommercialDispatchOutboxFilters,
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
  CommercialOfferCandidateFilters,
  CommercialPipelineRunData,
  CommercialPipelineRunFilters,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  CouponData,
  CouponRecord,
  CouponRepository,
  GeneratedCopyData,
  GeneratedCopyRecord,
  GeneratedCopyRepository,
  ProductLeadData,
  ProductLeadRecord,
  ProductRepository,
  ShopeeOfferFilters,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
  WhatsAppDestinationData,
  WhatsAppDestinationRecord,
  WhatsAppDestinationRepository,
  WhatsAppDestinationUpdate,
  WhatsAppDispatchCreateData,
  WhatsAppDispatchDetails,
  WhatsAppDispatchFilters,
  WhatsAppDispatchRecord,
  WhatsAppDispatchRepository,
  WhatsAppDispatchStatus,
  WhatsAppGroupCreateData,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupFilters,
  WhatsAppGroupRecord,
  WhatsAppGroupUpdate,
} from './repositories';
import type { ShopeeProductOffer } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { APPROVED_PRODUCT_MIN_SCORE } from './repositories';
import {
  COMMERCIAL_EXECUTION_OWNERSHIP_LOST,
  isCommercialAutomationExecutionStale,
} from './commercial-automation-execution-domain';

const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

class CommercialConfirmationNotClaimedError extends Error {}
class CommercialOutboxStateConflictError extends Error {}

type PrismaDecimalLike = { toString(): string } | number | string;

const decimalString = (value: PrismaDecimalLike | null | undefined) =>
  value === null || value === undefined ? undefined : value.toString();

const decimalNumber = (value: PrismaDecimalLike | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value.toString());

const mapProductLead = (
  record: Record<string, unknown>,
): ProductLeadRecord => ({
  ...(record as unknown as ProductLeadRecord),
  preco: decimalNumber(record.preco as PrismaDecimalLike),
  comissao: Number(record.comissao),
  url: (record.productLink as string | null | undefined) ?? null,
  commissionAmount:
    decimalString(record.commissionAmount as PrismaDecimalLike | null) ?? null,
});

const toPrismaProductData = (data: ProductLeadData) => ({
  source: 'MOCK' as const,
  providerProductId: data.providerProductId,
  nome: data.nome,
  categoria: data.categoria,
  preco: data.preco,
  desconto: data.desconto,
  nota: data.nota,
  vendidos: data.vendidos,
  comissao: data.comissao,
  loja: data.loja,
  urlImagem: data.urlImagem,
  productLink: data.url,
  title: data.title,
  fetchedAt: new Date(),
  lastSeenAt: new Date(),
});

const mapShopeeOffer = (
  record: Record<string, unknown>,
): ShopeeOfferRecord => ({
  id: String(record.id),
  source: record.source as ShopeeOfferRecord['source'],
  providerProductId: String(record.providerProductId),
  productName: String(record.nome),
  shopId: (record.shopId as string | null) ?? undefined,
  shopType: (record.shopType as number[]) ?? [],
  shopName: String(record.loja),
  categoryIds: (record.categoryIds as string[]) ?? [],
  price: decimalString(record.preco as PrismaDecimalLike) as string,
  priceMin:
    decimalString(record.precoMin as PrismaDecimalLike | null) ??
    (decimalString(record.preco as PrismaDecimalLike) as string),
  priceMax:
    decimalString(record.precoMax as PrismaDecimalLike | null) ??
    (decimalString(record.preco as PrismaDecimalLike) as string),
  discountRate: Number(record.desconto),
  rating: Number(record.nota),
  sales: Number(record.vendidos),
  commissionRate: Number(record.comissao),
  commissionAmount: decimalString(
    record.commissionAmount as PrismaDecimalLike | null,
  ),
  sellerCommissionRate:
    (record.sellerCommissionRate as number | null) ?? undefined,
  shopeeCommissionRate:
    (record.shopeeCommissionRate as number | null) ?? undefined,
  imageUrl: String(record.urlImagem),
  productLink: String(record.productLink ?? ''),
  affiliateLink: (record.affiliateLink as string | null) ?? undefined,
  offerStartsAt: (record.offerStartsAt as Date | null) ?? undefined,
  offerEndsAt: (record.offerEndsAt as Date | null) ?? undefined,
  fetchedAt: record.fetchedAt as Date,
  lastSeenAt: record.lastSeenAt as Date,
  unavailableAt: (record.unavailableAt as Date | null) ?? undefined,
  score: (record.score as number | null) ?? null,
  scoreUpdatedAt: (record.scoreUpdatedAt as Date | null) ?? null,
  createdAt: record.createdAt as Date,
  updatedAt: record.updatedAt as Date,
});

const toPrismaShopeeOffer = (offer: ShopeeProductOffer) => ({
  source: offer.source,
  providerProductId: offer.providerProductId,
  nome: offer.productName,
  categoria: offer.categoryIds[0] ?? 'Sem categoria',
  categoryIds: offer.categoryIds,
  preco: offer.price,
  precoMin: offer.priceMin,
  precoMax: offer.priceMax,
  desconto: offer.discountRate,
  nota: offer.rating,
  vendidos: offer.sales,
  comissao: offer.commissionRate,
  commissionAmount: offer.commissionAmount,
  sellerCommissionRate: offer.sellerCommissionRate,
  shopeeCommissionRate: offer.shopeeCommissionRate,
  loja: offer.shopName,
  shopId: offer.shopId,
  shopType: offer.shopType ?? [],
  urlImagem: offer.imageUrl,
  productLink: offer.productLink,
  affiliateLink: offer.affiliateLink,
  offerStartsAt: offer.offerStartsAt,
  offerEndsAt: offer.offerEndsAt,
  fetchedAt: offer.fetchedAt,
  lastSeenAt: new Date(),
  unavailableAt: null,
  title: offer.productName,
});

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      | 'productLead'
      | 'generatedCopy'
      | 'whatsAppDispatch'
      | 'whatsAppDestination'
    >,
  ) {}

  totalProducts(): Promise<number> {
    return this.prisma.productLead.count();
  }

  totalApprovedProducts(): Promise<number> {
    return this.prisma.productLead.count({
      where: { score: { gte: APPROVED_PRODUCT_MIN_SCORE } },
    });
  }

  totalGeneratedCopies(): Promise<number> {
    return this.prisma.generatedCopy.count();
  }

  totalQueuedDispatches(): Promise<number> {
    return this.prisma.whatsAppDispatch.count({
      where: { status: 'PENDING' },
    });
  }

  totalSentDispatches(): Promise<number> {
    return this.prisma.whatsAppDispatch.count({
      where: { status: 'SENT' },
    });
  }

  totalFailedDispatches(): Promise<number> {
    return this.prisma.whatsAppDispatch.count({
      where: { status: 'FAILED' },
    });
  }

  totalActiveDestinations(): Promise<number> {
    return this.prisma.whatsAppDestination.count({
      where: { active: true, type: 'INDIVIDUAL' },
    });
  }
}

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'productLead'>) {}

  async findById(id: string): Promise<ProductLeadRecord | null> {
    const record = await this.prisma.productLead.findUnique({
      where: { id },
    });
    return record
      ? mapProductLead(record as unknown as Record<string, unknown>)
      : null;
  }

  async findByProviderProductId(providerProductId: string) {
    return this.prisma.productLead.findUnique({
      where: {
        source_providerProductId: { source: 'MOCK', providerProductId },
      },
      select: { id: true },
    });
  }

  async create(data: ProductLeadData): Promise<ProductLeadRecord> {
    const record = await this.prisma.productLead.create({
      data: toPrismaProductData(data),
    });
    return mapProductLead(record as unknown as Record<string, unknown>);
  }

  async updateByProviderProductId(
    providerProductId: string,
    data: ProductLeadData,
  ): Promise<ProductLeadRecord> {
    const record = await this.prisma.productLead.update({
      where: {
        source_providerProductId: { source: 'MOCK', providerProductId },
      },
      data: toPrismaProductData(data),
    });
    return mapProductLead(record as unknown as Record<string, unknown>);
  }

  async listForScoring(): Promise<ProductLeadRecord[]> {
    const records = await this.prisma.productLead.findMany({
      where: {
        unavailableAt: null,
        OR: [{ offerEndsAt: null }, { offerEndsAt: { gt: new Date() } }],
      },
    });
    return records.map((record) =>
      mapProductLead(record as unknown as Record<string, unknown>),
    );
  }

  async updateScore(
    id: string,
    score: number,
    scoreUpdatedAt: Date,
  ): Promise<ProductLeadRecord> {
    const record = await this.prisma.productLead.update({
      where: { id },
      data: { score, scoreUpdatedAt },
    });
    return mapProductLead(record as unknown as Record<string, unknown>);
  }

  async listApproved(minScore: number): Promise<ProductLeadRecord[]> {
    const records = await this.prisma.productLead.findMany({
      where: { score: { gte: minScore } },
    });
    return records.map((record) =>
      mapProductLead(record as unknown as Record<string, unknown>),
    );
  }
}

export class PrismaShopeeOfferRepository implements ShopeeOfferRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'productLead'>) {}

  async findBySourceAndProviderProductId(
    source: ShopeeOfferRecord['source'],
    providerProductId: string,
  ) {
    return this.prisma.productLead.findUnique({
      where: { source_providerProductId: { source, providerProductId } },
      select: { id: true },
    });
  }

  async createOffer(offer: ShopeeProductOffer): Promise<ShopeeOfferRecord> {
    const record = await this.prisma.productLead.create({
      data: toPrismaShopeeOffer(offer),
    });
    return mapShopeeOffer(record as unknown as Record<string, unknown>);
  }

  async updateOffer(
    id: string,
    offer: ShopeeProductOffer,
  ): Promise<ShopeeOfferRecord> {
    const record = await this.prisma.productLead.update({
      where: { id },
      data: toPrismaShopeeOffer(offer),
    });
    return mapShopeeOffer(record as unknown as Record<string, unknown>);
  }

  async findOfferById(id: string): Promise<ShopeeOfferRecord | null> {
    const record = await this.prisma.productLead.findUnique({ where: { id } });
    return record
      ? mapShopeeOffer(record as unknown as Record<string, unknown>)
      : null;
  }

  async listOffers(filters: ShopeeOfferFilters) {
    const now = new Date();
    const statusWhere =
      filters.status === 'UNAVAILABLE'
        ? { unavailableAt: { not: null } }
        : filters.status === 'EXPIRED'
          ? { unavailableAt: null, offerEndsAt: { lte: now } }
          : filters.status === 'ACTIVE'
            ? {
                unavailableAt: null,
                OR: [{ offerEndsAt: null }, { offerEndsAt: { gt: now } }],
              }
            : {};
    const where = {
      source: filters.source,
      affiliateLink:
        filters.affiliateLink === 'present'
          ? { not: null }
          : filters.affiliateLink === 'missing'
            ? null
            : undefined,
      AND: [
        ...(filters.keyword
          ? [
              {
                OR: [
                  {
                    nome: {
                      contains: filters.keyword,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    loja: {
                      contains: filters.keyword,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ]
          : []),
        statusWhere,
      ],
    };
    const [records, total] = await Promise.all([
      this.prisma.productLead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.productLead.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapShopeeOffer(record as unknown as Record<string, unknown>),
      ),
      total,
    };
  }

  async listCommercialCandidates(filters: CommercialOfferCandidateFilters) {
    const records = await this.prisma.productLead.findMany({
      where: {
        source: filters.source,
        categoryIds: filters.categoryId
          ? { has: filters.categoryId }
          : undefined,
        preco: {
          gte: filters.minPrice,
          lte: filters.maxPrice,
        },
        desconto:
          filters.minDiscountRate === undefined
            ? undefined
            : { gte: filters.minDiscountRate },
        nota:
          filters.minRating === undefined
            ? undefined
            : { gte: filters.minRating },
        vendidos:
          filters.minSales === undefined
            ? undefined
            : { gte: filters.minSales },
        comissao:
          filters.minCommissionRate === undefined
            ? undefined
            : { gte: filters.minCommissionRate },
      },
      orderBy: { providerProductId: 'asc' },
      take: filters.limit,
    });
    return records.map((record) =>
      mapShopeeOffer(record as unknown as Record<string, unknown>),
    );
  }
}

const mapCommercialPipelineRun = (
  record: Record<string, unknown>,
): CommercialPipelineRunRecord => ({
  ...(record as unknown as CommercialPipelineRunRecord),
  productPrice:
    decimalString(record.productPrice as PrismaDecimalLike | null) ?? null,
  rejectionSummary: record.rejectionSummary as Record<string, number>,
  selectionReasons: record.selectionReasons as string[],
  plannedSubIds: record.plannedSubIds as string[],
});

const toPrismaCommercialPipelineRun = (
  data: Partial<CommercialPipelineRunData>,
) => ({
  ...data,
  ...(data.productPrice === undefined
    ? {}
    : { productPrice: data.productPrice }),
});

export class PrismaCommercialPipelineRunRepository implements CommercialPipelineRunRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'commercialPipelineRun'>,
  ) {}

  async create(
    data: CommercialPipelineRunData,
  ): Promise<CommercialPipelineRunRecord> {
    const record = await this.prisma.commercialPipelineRun.create({
      data: toPrismaCommercialPipelineRun(data) as never,
    });
    return mapCommercialPipelineRun(
      record as unknown as Record<string, unknown>,
    );
  }

  async update(
    id: string,
    data: Partial<CommercialPipelineRunData>,
  ): Promise<CommercialPipelineRunRecord> {
    const record = await this.prisma.commercialPipelineRun.update({
      where: { id },
      data: toPrismaCommercialPipelineRun(data) as never,
    });
    return mapCommercialPipelineRun(
      record as unknown as Record<string, unknown>,
    );
  }

  async list(filters: CommercialPipelineRunFilters) {
    const where = {
      status: filters.status,
      mode: filters.mode,
      productId: filters.productId,
    };
    const [records, total] = await Promise.all([
      this.prisma.commercialPipelineRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.commercialPipelineRun.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialPipelineRun(record as unknown as Record<string, unknown>),
      ),
      total,
    };
  }

  async findById(id: string): Promise<CommercialPipelineRunRecord | null> {
    const record = await this.prisma.commercialPipelineRun.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialPipelineRun(record as unknown as Record<string, unknown>)
      : null;
  }

  async findByDispatchId(
    dispatchId: string,
  ): Promise<CommercialPipelineRunRecord | null> {
    if (!this.prisma.commercialPipelineRun) return null;
    const record = await this.prisma.commercialPipelineRun.findUnique({
      where: { dispatchId } as never,
    });
    return record
      ? mapCommercialPipelineRun(record as unknown as Record<string, unknown>)
      : null;
  }
}

export class PrismaCommercialDeliveryHistoryRepository implements CommercialDeliveryHistoryRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      'whatsAppDispatch' | 'commercialPipelineRun'
    >,
  ) {}

  async wasProductSentToGroup(
    productId: string,
    groupId: string,
  ): Promise<boolean> {
    const [sentDispatch, confirmedRun] = await Promise.all([
      this.prisma.whatsAppDispatch.findFirst({
        where: {
          productId,
          destinationId: groupId,
          status: 'SENT',
        },
        select: { id: true },
      }),
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          productId,
          groupDestinationId: groupId,
          mode: 'CONFIRMED',
          status: 'COMPLETED',
        },
        select: { id: true },
      }),
    ]);
    return Boolean(sentDispatch || confirmedRun);
  }
}

const mapCommercialDispatchOutbox = (
  record: Record<string, unknown>,
): CommercialDispatchOutboxRecord =>
  record as unknown as CommercialDispatchOutboxRecord;

export class PrismaCommercialDispatchOutboxRepository implements CommercialDispatchOutboxRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async createPendingConfirmation(
    input: CommercialConfirmationPersistenceInput,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.commercialPipelineRun.updateMany({
          where: {
            id: input.runId,
            mode: 'DRY_RUN',
            status: 'COMPLETED',
            confirmedAt: null,
            dispatchId: null,
            jobId: null,
          },
          data: {
            mode: 'CONFIRMED',
            status: 'STARTED',
            confirmedAt: input.confirmedAt,
            completedAt: null,
            finalStatus: 'PENDING',
            failureCode: null,
            investigationRequired: false,
          },
        });
        if (claimed.count !== 1) {
          throw new CommercialConfirmationNotClaimedError();
        }

        await transaction.generatedCopy.create({ data: input.copy });
        await transaction.whatsAppDispatch.create({
          data: { ...input.dispatch, status: 'PENDING', attemptCount: 0 },
        });
        const outbox = await transaction.commercialDispatchOutbox.create({
          data: {
            id: input.outboxId,
            commercialRunId: input.runId,
            dispatchId: input.dispatch.id,
            jobId: input.jobId,
            status: 'PENDING',
          },
        });
        await transaction.commercialPipelineRun.update({
          where: { id: input.runId },
          data: { dispatchId: input.dispatch.id },
        });
        return outbox;
      });
      return mapCommercialDispatchOutbox(
        record as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (error instanceof CommercialConfirmationNotClaimedError) {
        return null;
      }
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          'Estado persistido da confirmacao comercial e inconsistente',
          'COMMERCIAL_OUTBOX_INCONSISTENT',
        );
      }
      throw error;
    }
  }

  async list(filters: CommercialDispatchOutboxFilters) {
    const where = { status: filters.status };
    const [records, total] = await Promise.all([
      this.prisma.commercialDispatchOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.commercialDispatchOutbox.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialDispatchOutbox(
          record as unknown as Record<string, unknown>,
        ),
      ),
      total,
    };
  }

  async findById(id: string): Promise<CommercialDispatchOutboxRecord | null> {
    const record = await this.prisma.commercialDispatchOutbox.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialDispatchOutbox(
          record as unknown as Record<string, unknown>,
        )
      : null;
  }

  async findPublicationContext(
    id: string,
  ): Promise<CommercialDispatchOutboxPublicationContext | null> {
    const record = await this.prisma.commercialDispatchOutbox.findUnique({
      where: { id },
      include: {
        commercialRun: {
          select: {
            id: true,
            mode: true,
            status: true,
            dispatchId: true,
            jobId: true,
            finalStatus: true,
            investigationRequired: true,
          },
        },
        dispatch: { select: { id: true, status: true, attemptCount: true } },
      },
    });
    if (!record) return null;
    const { commercialRun, dispatch, ...outbox } = record;
    return {
      outbox: mapCommercialDispatchOutbox(
        outbox as unknown as Record<string, unknown>,
      ),
      run: commercialRun,
      dispatch,
    };
  }

  async markPublished(
    id: string,
    publishedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const outbox = await transaction.commercialDispatchOutbox.findUnique({
          where: { id },
        });
        if (!outbox || outbox.status === 'AMBIGUOUS') return null;
        if (outbox.status === 'PUBLISHED') {
          return mapCommercialDispatchOutbox(
            outbox as unknown as Record<string, unknown>,
          );
        }
        const promoted = await transaction.commercialDispatchOutbox.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: 'PUBLISHED',
            failureCode: null,
            publishedAt,
          },
        });
        if (promoted.count !== 1) return null;
        const runUpdated = await transaction.commercialPipelineRun.updateMany({
          where: {
            id: outbox.commercialRunId,
            mode: 'CONFIRMED',
            dispatchId: outbox.dispatchId,
            OR: [{ jobId: null }, { jobId: outbox.jobId }],
          },
          data: { jobId: outbox.jobId },
        });
        if (runUpdated.count !== 1) {
          throw new CommercialOutboxStateConflictError();
        }
        const published = await transaction.commercialDispatchOutbox.findUnique(
          {
            where: { id },
          },
        );
        if (!published) throw new CommercialOutboxStateConflictError();
        return mapCommercialDispatchOutbox(
          published as unknown as Record<string, unknown>,
        );
      });
    } catch (error) {
      if (error instanceof CommercialOutboxStateConflictError) {
        return null;
      }
      throw error;
    }
  }

  async markAmbiguous(
    id: string,
    failureCode: string,
    completedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const outbox = await transaction.commercialDispatchOutbox.findUnique({
        where: { id },
      });
      if (!outbox) return null;
      if (outbox.status === 'AMBIGUOUS') {
        return mapCommercialDispatchOutbox(
          outbox as unknown as Record<string, unknown>,
        );
      }
      const changed = await transaction.commercialDispatchOutbox.updateMany({
        where: { id, status: { in: ['PENDING', 'PUBLISHED'] } },
        data: { status: 'AMBIGUOUS', failureCode },
      });
      if (changed.count !== 1) return null;
      await transaction.commercialPipelineRun.update({
        where: { id: outbox.commercialRunId },
        data: {
          status: 'FAILED',
          finalStatus: 'AMBIGUOUS',
          investigationRequired: true,
          failureCode,
          completedAt,
        },
      });
      const ambiguous = await transaction.commercialDispatchOutbox.findUnique({
        where: { id },
      });
      if (!ambiguous) return null;
      return mapCommercialDispatchOutbox(
        ambiguous as unknown as Record<string, unknown>,
      );
    });
  }
}

const COMMERCIAL_AUTOMATION_SETTINGS_ID = 'commercial-automation';

export class PrismaCommercialAutomationSettingsRepository implements CommercialAutomationSettingsRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      'commercialAutomationSettings'
    >,
  ) {}

  async get(): Promise<CommercialAutomationSettingsRecord | null> {
    return this.prisma.commercialAutomationSettings.findUnique({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
    });
  }

  async getOrCreate(now: Date): Promise<CommercialAutomationSettingsRecord> {
    return this.prisma.commercialAutomationSettings.upsert({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
      create: {
        id: COMMERCIAL_AUTOMATION_SETTINGS_ID,
        paused: true,
        pausedAt: now,
      },
      update: {},
    });
  }

  async setPaused(
    paused: boolean,
    now: Date,
  ): Promise<CommercialAutomationSettingsRecord> {
    const current = await this.getOrCreate(now);
    if (current.paused === paused) return current;
    return this.prisma.commercialAutomationSettings.update({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
      data: paused
        ? { paused: true, pausedAt: now }
        : { paused: false, resumedAt: now },
    });
  }
}

const COMMERCIAL_AUTOMATION_ACTIVE_KEY = 'commercial-automation';

const staleCommercialExecutionWhere = (at: Date) => ({
  status: 'STARTED' as const,
  OR: [
    { activeKey: null },
    { ownerId: null },
    { heartbeatAt: null },
    { leaseExpiresAt: null },
    { leaseExpiresAt: { lte: at } },
  ],
});

const ownedCommercialExecutionWhere = (
  ownership: CommercialAutomationExecutionOwnership,
  at: Date,
) => ({
  id: ownership.executionId,
  status: 'STARTED' as const,
  ownerId: ownership.ownerId,
  activeKey: { not: null },
  leaseExpiresAt: { gt: at },
});

export class PrismaCommercialAutomationHistoryRepository implements CommercialAutomationHistoryRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      | 'whatsAppDispatch'
      | 'commercialPipelineRun'
      | 'commercialAutomationExecution'
    >,
  ) {}

  async getSnapshot({
    groupId,
    dayStartsAt,
    dayEndsAt,
  }: {
    groupId?: string;
    dayStartsAt: Date;
    dayEndsAt: Date;
  }) {
    const sentDuringDay = {
      status: 'SENT' as const,
      sentAt: { gte: dayStartsAt, lt: dayEndsAt },
      destination: { type: 'GROUP' as const },
    };
    const [countsByGroup, lastSent] = await Promise.all([
      this.prisma.whatsAppDispatch.groupBy({
        by: ['destinationId'],
        where: sentDuringDay,
        _count: { _all: true },
      }),
      this.prisma.whatsAppDispatch.findFirst({
        where: {
          status: 'SENT',
          sentAt: { not: null },
          destination: { type: 'GROUP' },
        },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
    ]);
    const globalSentToday = countsByGroup.reduce(
      (total, row) => total + row._count._all,
      0,
    );
    const groupSentToday = groupId
      ? (countsByGroup.find((row) => row.destinationId === groupId)?._count
          ._all ?? 0)
      : 0;
    return {
      globalSentToday,
      groupSentToday,
      lastSentAt: lastSent?.sentAt ?? null,
    };
  }

  async hasAmbiguousCommercialExecution(): Promise<boolean> {
    const [run, execution] = await Promise.all([
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          OR: [{ finalStatus: 'AMBIGUOUS' }, { investigationRequired: true }],
        },
        select: { id: true },
      }),
      this.prisma.commercialAutomationExecution.findFirst({
        where: { status: 'AMBIGUOUS' },
        select: { id: true },
      }),
    ]);
    return Boolean(run || execution);
  }

  async hasActiveCommercialExecution(
    now: Date,
    excludedExecutionId?: string,
  ): Promise<boolean> {
    const [run, execution] = await Promise.all([
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          OR: [
            { mode: 'CONFIRMED', status: 'STARTED' },
            { finalStatus: 'PENDING' },
            { dispatch: { status: { in: ['PENDING', 'PROCESSING'] } } },
          ],
        },
        select: { id: true },
      }),
      this.prisma.commercialAutomationExecution.findFirst({
        where: {
          status: 'STARTED',
          activeKey: { not: null },
          ownerId: { not: null },
          heartbeatAt: { not: null },
          leaseExpiresAt: { gt: now },
          ...(excludedExecutionId ? { id: { not: excludedExecutionId } } : {}),
        },
        select: { id: true },
      }),
    ]);
    return Boolean(run || execution);
  }

  async hasStaleCommercialExecution(now: Date): Promise<boolean> {
    return Boolean(
      await this.prisma.commercialAutomationExecution.findFirst({
        where: staleCommercialExecutionWhere(now),
        select: { id: true },
      }),
    );
  }
}

const mapCommercialAutomationExecution = (
  record: Record<string, unknown>,
): CommercialAutomationExecutionRecord => ({
  id: record.id as string,
  schedulerJobId: record.schedulerJobId as string,
  bullMqJobId: (record.bullMqJobId as string | null) ?? null,
  activeKey: (record.activeKey as string | null) ?? null,
  ownerId: (record.ownerId as string | null) ?? null,
  heartbeatAt: (record.heartbeatAt as Date | null) ?? null,
  leaseExpiresAt: (record.leaseExpiresAt as Date | null) ?? null,
  mode: record.mode as CommercialAutomationExecutionRecord['mode'],
  status: record.status as CommercialAutomationExecutionRecord['status'],
  reasons: record.reasons as string[],
  commercialRunId: (record.commercialRunId as string | null) ?? null,
  failureCode: (record.failureCode as string | null) ?? null,
  startedAt: record.startedAt as Date,
  completedAt: (record.completedAt as Date | null) ?? null,
});

export class PrismaCommercialAutomationExecutionRepository implements CommercialAutomationExecutionRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      'commercialAutomationExecution' | 'commercialPipelineRun'
    >,
  ) {}

  private async findByBullMqJobId(bullMqJobId: string) {
    const record = await this.prisma.commercialAutomationExecution.findUnique({
      where: { bullMqJobId },
    });
    return record
      ? mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        )
      : null;
  }

  async start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionRecord['mode'];
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
  }) {
    try {
      const record = await this.prisma.commercialAutomationExecution.create({
        data: {
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          activeKey: COMMERCIAL_AUTOMATION_ACTIVE_KEY,
          ownerId: input.ownerId,
          heartbeatAt: input.heartbeatAt,
          leaseExpiresAt: input.leaseExpiresAt,
          mode: input.mode,
          status: 'STARTED',
          reasons: [],
          startedAt: input.startedAt,
        },
      });
      return {
        outcome: 'created' as const,
        execution: mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        ),
        ownership: {
          executionId: record.id,
          ownerId: input.ownerId,
        },
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = input.bullMqJobId
        ? await this.findByBullMqJobId(input.bullMqJobId)
        : null;
      if (existing)
        return { outcome: 'existing' as const, execution: existing };
      const active = await this.prisma.commercialAutomationExecution.findUnique(
        {
          where: { activeKey: COMMERCIAL_AUTOMATION_ACTIVE_KEY },
        },
      );
      return {
        outcome: 'concurrent' as const,
        stale: active
          ? isCommercialAutomationExecutionStale(
              mapCommercialAutomationExecution(
                active as unknown as Record<string, unknown>,
              ),
              input.startedAt,
            )
          : false,
      };
    }
  }

  async createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionRecord['mode'];
    reasons: string[];
    completedAt: Date;
  }) {
    try {
      const record = await this.prisma.commercialAutomationExecution.create({
        data: {
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          mode: input.mode,
          status: 'BLOCKED',
          reasons: input.reasons,
          startedAt: input.completedAt,
          completedAt: input.completedAt,
        },
      });
      return mapCommercialAutomationExecution(
        record as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (!isUniqueConstraintError(error) || !input.bullMqJobId) throw error;
      const existing = await this.findByBullMqJobId(input.bullMqJobId);
      if (!existing) throw error;
      return existing;
    }
  }

  async heartbeat(
    ownership: CommercialAutomationExecutionOwnership,
    input: { heartbeatAt: Date; leaseExpiresAt: Date },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        ...ownedCommercialExecutionWhere(ownership, input.heartbeatAt),
      },
      data: {
        heartbeatAt: input.heartbeatAt,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
    if (updated.count !== 1) this.throwOwnershipLost();
  }

  async finish(
    ownership: CommercialAutomationExecutionOwnership,
    input: {
      status: Exclude<CommercialAutomationExecutionRecord['status'], 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        ...ownedCommercialExecutionWhere(ownership, input.completedAt),
      },
      data: {
        activeKey: null,
        status: input.status,
        reasons: input.reasons,
        commercialRunId: input.commercialRunId,
        failureCode: input.failureCode,
        completedAt: input.completedAt,
      },
    });
    if (updated.count !== 1) this.throwOwnershipLost();
    return this.findExecutionAfterMutation(ownership.executionId);
  }

  async findRecoveryContext(
    id: string,
  ): Promise<CommercialAutomationExecutionRecoveryContext | null> {
    const execution = await this.findById(id);
    if (!execution) return null;
    if (!execution.commercialRunId) return { execution, run: null };
    const run = await this.prisma.commercialPipelineRun.findUnique({
      where: { id: execution.commercialRunId },
      include: { dispatch: true, dispatchOutbox: true },
    });
    if (!run) return { execution, run: null };
    return {
      execution,
      run: {
        id: run.id,
        mode: run.mode,
        dispatchId: run.dispatchId,
        jobId: run.jobId,
        finalStatus: run.finalStatus,
        investigationRequired: run.investigationRequired,
        dispatch: run.dispatch
          ? {
              id: run.dispatch.id,
              status: run.dispatch.status,
              attemptCount: run.dispatch.attemptCount,
            }
          : null,
        outbox: run.dispatchOutbox
          ? mapCommercialDispatchOutbox(
              run.dispatchOutbox as unknown as Record<string, unknown>,
            )
          : null,
      },
    };
  }

  async recoverStale(
    id: string,
    input: {
      status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        id,
        ...staleCommercialExecutionWhere(input.completedAt),
      },
      data: {
        activeKey: null,
        status: input.status,
        failureCode: input.failureCode,
        completedAt: input.completedAt,
      },
    });
    if (updated.count !== 1) {
      const current = await this.findById(id);
      if (current && current.status !== 'STARTED') return current;
      this.throwOwnershipLost();
    }
    return this.findExecutionAfterMutation(id);
  }

  private async findExecutionAfterMutation(id: string) {
    const record = await this.findById(id);
    if (!record) this.throwOwnershipLost();
    return record;
  }

  private throwOwnershipLost(): never {
    throw new AppError(
      'Ownership da execucao comercial foi perdido',
      COMMERCIAL_EXECUTION_OWNERSHIP_LOST,
    );
  }

  async list(input: { page: number; limit: number }) {
    const where = {};
    const [records, total] = await Promise.all([
      this.prisma.commercialAutomationExecution.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.commercialAutomationExecution.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        ),
      ),
      total,
    };
  }

  async findById(id: string) {
    const record = await this.prisma.commercialAutomationExecution.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        )
      : null;
  }
}

const mapCoupon = (record: Record<string, unknown>): CouponRecord => ({
  ...(record as unknown as CouponRecord),
  discountValue: decimalString(
    record.discountValue as PrismaDecimalLike,
  ) as string,
  minPurchase:
    decimalString(record.minPurchase as PrismaDecimalLike | null) ?? null,
  maxDiscount:
    decimalString(record.maxDiscount as PrismaDecimalLike | null) ?? null,
});

export class PrismaCouponRepository implements CouponRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'coupon'>) {}

  async create(data: CouponData): Promise<CouponRecord> {
    const record = await this.prisma.coupon.create({ data });
    return mapCoupon(record as unknown as Record<string, unknown>);
  }

  async list(): Promise<CouponRecord[]> {
    const records = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) =>
      mapCoupon(record as unknown as Record<string, unknown>),
    );
  }

  async findById(id: string): Promise<CouponRecord | null> {
    const record = await this.prisma.coupon.findUnique({ where: { id } });
    return record
      ? mapCoupon(record as unknown as Record<string, unknown>)
      : null;
  }

  async update(
    id: string,
    data: Partial<CouponData>,
  ): Promise<CouponRecord | null> {
    const existing = await this.prisma.coupon.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    const record = await this.prisma.coupon.update({ where: { id }, data });
    return mapCoupon(record as unknown as Record<string, unknown>);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.prisma.coupon.deleteMany({ where: { id } });
    return result.count === 1;
  }
}

export class PrismaGeneratedCopyRepository implements GeneratedCopyRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'generatedCopy'>) {}

  async create(data: GeneratedCopyData): Promise<GeneratedCopyRecord> {
    return (await this.prisma.generatedCopy.create({
      data,
    })) as GeneratedCopyRecord;
  }

  async findById(id: string): Promise<GeneratedCopyRecord | null> {
    return (await this.prisma.generatedCopy.findUnique({
      where: { id },
    })) as GeneratedCopyRecord | null;
  }
}

export class PrismaWhatsAppDestinationRepository implements WhatsAppDestinationRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDestination'>,
  ) {}

  async findById(id: string): Promise<WhatsAppDestinationRecord | null> {
    return (await this.prisma.whatsAppDestination.findFirst({
      where: { id, type: 'INDIVIDUAL' },
    })) as WhatsAppDestinationRecord | null;
  }

  async listActive(): Promise<WhatsAppDestinationRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      // Groups are authorized separately and never participate in Pipeline.
      where: { active: true, type: 'INDIVIDUAL' },
    })) as WhatsAppDestinationRecord[];
  }

  async create(
    data: WhatsAppDestinationData,
  ): Promise<WhatsAppDestinationRecord> {
    return (await this.prisma.whatsAppDestination.create({
      data: { ...data, type: 'INDIVIDUAL', available: true },
    })) as WhatsAppDestinationRecord;
  }

  async list(): Promise<WhatsAppDestinationRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: { type: 'INDIVIDUAL' },
      orderBy: { createdAt: 'desc' },
    })) as WhatsAppDestinationRecord[];
  }

  async update(
    id: string,
    data: WhatsAppDestinationUpdate,
  ): Promise<WhatsAppDestinationRecord | null> {
    try {
      const existing = await this.prisma.whatsAppDestination.findFirst({
        where: { id, type: 'INDIVIDUAL' },
        select: { id: true },
      });
      if (!existing) return null;
      return (await this.prisma.whatsAppDestination.update({
        where: { id },
        data,
      })) as WhatsAppDestinationRecord;
    } catch {
      return null;
    }
  }
}

export class PrismaWhatsAppGroupDirectoryRepository implements WhatsAppGroupDirectoryRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDestination'>,
  ) {}

  async findById(id: string): Promise<WhatsAppGroupRecord | null> {
    return (await this.prisma.whatsAppDestination.findFirst({
      where: { id, type: 'GROUP' },
    })) as WhatsAppGroupRecord | null;
  }

  async findByExternalGroupId(
    sourceInstanceName: string,
    externalGroupId: string,
  ): Promise<WhatsAppGroupRecord | null> {
    return (await this.prisma.whatsAppDestination.findFirst({
      where: {
        type: 'GROUP',
        sourceInstanceName,
        destination: externalGroupId,
      },
    })) as WhatsAppGroupRecord | null;
  }

  async listByInstance(
    sourceInstanceName: string,
  ): Promise<WhatsAppGroupRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: { type: 'GROUP', sourceInstanceName },
      orderBy: { name: 'asc' },
    })) as WhatsAppGroupRecord[];
  }

  async list(
    sourceInstanceName: string,
    filters: WhatsAppGroupFilters = {},
  ): Promise<WhatsAppGroupRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: {
        type: 'GROUP',
        sourceInstanceName,
        active: filters.active,
        available: filters.available,
      },
      orderBy: { name: 'asc' },
    })) as WhatsAppGroupRecord[];
  }

  async create(data: WhatsAppGroupCreateData): Promise<WhatsAppGroupRecord> {
    return (await this.prisma.whatsAppDestination.create({
      data,
    })) as WhatsAppGroupRecord;
  }

  async update(
    id: string,
    data: WhatsAppGroupUpdate,
  ): Promise<WhatsAppGroupRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    return (await this.prisma.whatsAppDestination.update({
      where: { id },
      data,
    })) as WhatsAppGroupRecord;
  }
}

export class PrismaWhatsAppDispatchRepository implements WhatsAppDispatchRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDispatch'>,
  ) {}

  async createPending(
    data: WhatsAppDispatchCreateData,
  ): Promise<WhatsAppDispatchRecord | null> {
    try {
      return (await this.prisma.whatsAppDispatch.create({
        data: { ...data, status: 'PENDING' },
      })) as WhatsAppDispatchRecord;
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  async findByIdForSending(
    id: string,
  ): Promise<WhatsAppDispatchDetails | null> {
    return (await this.prisma.whatsAppDispatch.findUnique({
      where: { id },
      include: { generatedCopy: true, destination: true, product: true },
    })) as WhatsAppDispatchDetails | null;
  }

  async findByIdWithDetails(
    id: string,
  ): Promise<WhatsAppDispatchDetails | null> {
    return (await this.prisma.whatsAppDispatch.findUnique({
      where: { id },
      include: { product: true, generatedCopy: true, destination: true },
    })) as WhatsAppDispatchDetails | null;
  }

  async list(
    filters: WhatsAppDispatchFilters,
  ): Promise<WhatsAppDispatchDetails[]> {
    const status = (
      ['PENDING', 'PROCESSING', 'SENT', 'FAILED'] as WhatsAppDispatchStatus[]
    ).includes(filters.status as WhatsAppDispatchStatus)
      ? (filters.status as WhatsAppDispatchStatus)
      : undefined;

    return (await this.prisma.whatsAppDispatch.findMany({
      where: {
        status,
        destinationId: filters.destinationId,
        productId: filters.productId,
      } as never,
      include: { product: true, generatedCopy: true, destination: true },
      orderBy: { createdAt: 'desc' },
    })) as WhatsAppDispatchDetails[];
  }

  async markAttemptPending(id: string): Promise<boolean> {
    const result = await this.prisma.whatsAppDispatch.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        errorMessage: null,
      } as never,
    });
    return result.count === 1;
  }

  async markSent(
    id: string,
    data: { externalMessageId: string; sentAt: Date },
  ): Promise<WhatsAppDispatchRecord> {
    return (await this.prisma.whatsAppDispatch.update({
      where: { id },
      data: {
        status: 'SENT',
        externalMessageId: data.externalMessageId,
        sentAt: data.sentAt,
        errorMessage: null,
      },
    })) as WhatsAppDispatchRecord;
  }

  async markFailed(
    id: string,
    errorMessage: string,
  ): Promise<WhatsAppDispatchRecord> {
    return (await this.prisma.whatsAppDispatch.update({
      where: { id },
      data: { status: 'FAILED', errorMessage },
    })) as WhatsAppDispatchRecord;
  }
}
