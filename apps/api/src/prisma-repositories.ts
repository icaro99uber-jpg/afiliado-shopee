import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  AnalyticsRepository,
  GeneratedCopyData,
  GeneratedCopyRecord,
  GeneratedCopyRepository,
  ProductLeadData,
  ProductLeadRecord,
  ProductRepository,
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
} from './repositories';
import { APPROVED_PRODUCT_MIN_SCORE } from './repositories';

const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

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
      where: { active: true },
    });
  }
}

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'productLead'>) {}

  async findById(id: string): Promise<ProductLeadRecord | null> {
    return (await this.prisma.productLead.findUnique({
      where: { id },
    })) as ProductLeadRecord | null;
  }

  async findByProviderProductId(providerProductId: string) {
    return this.prisma.productLead.findUnique({
      where: { providerProductId },
      select: { id: true },
    });
  }

  async create(data: ProductLeadData): Promise<ProductLeadRecord> {
    return (await this.prisma.productLead.create({
      data,
    })) as ProductLeadRecord;
  }

  async updateByProviderProductId(
    providerProductId: string,
    data: ProductLeadData,
  ): Promise<ProductLeadRecord> {
    return (await this.prisma.productLead.update({
      where: { providerProductId },
      data,
    })) as ProductLeadRecord;
  }

  async listForScoring(): Promise<ProductLeadRecord[]> {
    return (await this.prisma.productLead.findMany()) as ProductLeadRecord[];
  }

  async updateScore(
    id: string,
    score: number,
    scoreUpdatedAt: Date,
  ): Promise<ProductLeadRecord> {
    return (await this.prisma.productLead.update({
      where: { id },
      data: { score, scoreUpdatedAt },
    })) as ProductLeadRecord;
  }

  async listApproved(minScore: number): Promise<ProductLeadRecord[]> {
    return (await this.prisma.productLead.findMany({
      where: { score: { gte: minScore } },
    })) as ProductLeadRecord[];
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

export class PrismaWhatsAppDestinationRepository
  implements WhatsAppDestinationRepository
{
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDestination'>,
  ) {}

  async findById(id: string): Promise<WhatsAppDestinationRecord | null> {
    return (await this.prisma.whatsAppDestination.findUnique({
      where: { id },
    })) as WhatsAppDestinationRecord | null;
  }

  async listActive(): Promise<WhatsAppDestinationRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: { active: true },
    })) as WhatsAppDestinationRecord[];
  }

  async create(
    data: WhatsAppDestinationData,
  ): Promise<WhatsAppDestinationRecord> {
    return (await this.prisma.whatsAppDestination.create({
      data,
    })) as WhatsAppDestinationRecord;
  }

  async list(): Promise<WhatsAppDestinationRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      orderBy: { createdAt: 'desc' },
    })) as WhatsAppDestinationRecord[];
  }

  async update(
    id: string,
    data: WhatsAppDestinationUpdate,
  ): Promise<WhatsAppDestinationRecord | null> {
    try {
      return (await this.prisma.whatsAppDestination.update({
        where: { id },
        data,
      })) as WhatsAppDestinationRecord;
    } catch {
      return null;
    }
  }
}

export class PrismaWhatsAppDispatchRepository
  implements WhatsAppDispatchRepository
{
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
