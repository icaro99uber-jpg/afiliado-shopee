import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  CommercialDispatchOutboxFilters,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
} from './repositories';

export const sanitizeCommercialDispatchOutbox = (
  record: CommercialDispatchOutboxRecord,
) => ({
  id: record.id,
  commercialRunId: record.commercialRunId,
  dispatchId: record.dispatchId,
  jobId: record.jobId,
  status: record.status.toLowerCase() as 'pending' | 'published' | 'ambiguous',
  failureCode: record.failureCode,
  createdAt: record.createdAt.toISOString(),
  publishedAt: record.publishedAt?.toISOString() ?? null,
});

export class CommercialDispatchOutboxService {
  constructor(private readonly outboxes: CommercialDispatchOutboxRepository) {}

  async list(filters: CommercialDispatchOutboxFilters) {
    const result = await this.outboxes.list(filters);
    return {
      items: result.items.map(sanitizeCommercialDispatchOutbox),
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
    };
  }

  async find(id: string) {
    const outbox = await this.outboxes.findById(id);
    if (!outbox) {
      throw new AppError(
        'Outbox comercial nao encontrado',
        'COMMERCIAL_OUTBOX_NOT_FOUND',
      );
    }
    return sanitizeCommercialDispatchOutbox(outbox);
  }
}
