import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  AnalyticsRepository,
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
import { APPROVED_PRODUCT_MIN_SCORE } from './repositories';

const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

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
      ['PENDING', 'SENT', 'FAILED'] as WhatsAppDispatchStatus[]
    ).includes(filters.status as WhatsAppDispatchStatus)
      ? (filters.status as WhatsAppDispatchStatus)
      : undefined;

    return (await this.prisma.whatsAppDispatch.findMany({
      where: {
        status,
        destinationId: filters.destinationId,
        productId: filters.productId,
      },
      include: { product: true, generatedCopy: true, destination: true },
      orderBy: { createdAt: 'desc' },
    })) as WhatsAppDispatchDetails[];
  }

  async markAttemptPending(id: string): Promise<WhatsAppDispatchRecord> {
    return (await this.prisma.whatsAppDispatch.update({
      where: { id },
      data: {
        status: 'PENDING',
        attemptCount: { increment: 1 },
        errorMessage: null,
      },
    })) as WhatsAppDispatchRecord;
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
