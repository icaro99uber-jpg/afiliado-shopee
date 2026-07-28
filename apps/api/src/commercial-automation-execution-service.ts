import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRepository,
} from './repositories';
import {
  isCommercialAutomationExecutionStale,
  toPublicCommercialAutomationMode,
  toPublicCommercialAutomationStatus,
} from './commercial-automation-execution-domain';

export const sanitizeCommercialAutomationExecution = (
  execution: CommercialAutomationExecutionRecord,
  now = new Date(),
) => ({
  id: execution.id,
  schedulerJobId: execution.schedulerJobId,
  bullMqJobId: execution.bullMqJobId,
  mode: toPublicCommercialAutomationMode(execution.mode),
  status: toPublicCommercialAutomationStatus(execution.status),
  reasons: execution.reasons,
  commercialRunId: execution.commercialRunId,
  failureCode: execution.failureCode,
  stale: isCommercialAutomationExecutionStale(execution, now),
  heartbeatAt: execution.heartbeatAt?.toISOString() ?? null,
  leaseExpiresAt: execution.leaseExpiresAt?.toISOString() ?? null,
  startedAt: execution.startedAt.toISOString(),
  completedAt: execution.completedAt?.toISOString() ?? null,
});

export class CommercialAutomationExecutionService {
  private readonly clock: () => Date;

  constructor(
    private readonly executions: CommercialAutomationExecutionRepository,
    clock: () => Date = () => new Date(),
  ) {
    this.clock = clock;
  }

  async list(input: { page: number; limit: number }) {
    const result = await this.executions.list(input);
    const now = this.clock();
    return {
      items: result.items.map((execution) =>
        sanitizeCommercialAutomationExecution(execution, now),
      ),
      page: input.page,
      limit: input.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / input.limit)),
    };
  }

  async find(id: string) {
    const execution = await this.executions.findById(id);
    if (!execution) {
      throw new AppError(
        'Execucao da automacao comercial nao encontrada',
        'COMMERCIAL_AUTOMATION_EXECUTION_NOT_FOUND',
      );
    }
    return sanitizeCommercialAutomationExecution(execution, this.clock());
  }
}
