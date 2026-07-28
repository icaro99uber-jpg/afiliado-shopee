import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { isCommercialAutomationExecutionStale } from './commercial-automation-execution-domain';
import { sanitizeCommercialAutomationExecution } from './commercial-automation-execution-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationExecutionRepository,
} from './repositories';

export const COMMERCIAL_EXECUTION_ABANDONED_SAFE =
  'COMMERCIAL_EXECUTION_ABANDONED_SAFE';
export const COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED =
  'COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED';
export const COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS =
  'COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS';
export const COMMERCIAL_EXECUTION_DISPATCH_FAILED =
  'COMMERCIAL_EXECUTION_DISPATCH_FAILED';

type RecoveryDecision = {
  status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
  failureCode?: string;
};

type CommercialDispatchJobEvidence = {
  id: string;
  dispatchId: string;
};

const baseIdentitiesAreConsistent = (
  context: CommercialAutomationExecutionRecoveryContext,
) => {
  const { execution, run } = context;
  if (!run || !run.dispatch || !run.outbox) return false;
  return (
    execution.commercialRunId === run.id &&
    run.dispatchId === run.dispatch.id &&
    run.dispatchId === run.outbox.dispatchId &&
    run.id === run.outbox.commercialRunId &&
    (run.jobId === null || run.jobId === run.outbox.jobId)
  );
};

export class CommercialAutomationExecutionRecoveryService {
  private readonly clock: () => Date;

  constructor(
    private readonly dependencies: {
      executions: CommercialAutomationExecutionRepository;
      jobs: {
        findJob(jobId: string): Promise<CommercialDispatchJobEvidence | null>;
      };
      clock?: () => Date;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async recover(executionId: string) {
    const now = this.clock();
    const context =
      await this.dependencies.executions.findRecoveryContext(executionId);
    if (!context) {
      throw new AppError(
        'Execucao da automacao comercial nao encontrada',
        'COMMERCIAL_AUTOMATION_EXECUTION_NOT_FOUND',
      );
    }
    if (context.execution.status !== 'STARTED') {
      return this.result('already-terminal', context.execution, now);
    }
    if (!isCommercialAutomationExecutionStale(context.execution, now)) {
      throw new AppError(
        'Execucao comercial ainda possui lease valida',
        'COMMERCIAL_EXECUTION_NOT_STALE',
      );
    }

    const decision = await this.classify(context);
    const recovered = await this.dependencies.executions.recoverStale(
      executionId,
      { ...decision, completedAt: now },
    );
    return this.result('recovered', recovered, now);
  }

  private async classify(
    context: CommercialAutomationExecutionRecoveryContext,
  ): Promise<RecoveryDecision> {
    const { execution, run } = context;
    if (!execution.commercialRunId) {
      return {
        status: 'FAILED',
        failureCode: COMMERCIAL_EXECUTION_ABANDONED_SAFE,
      };
    }
    if (!run) return this.ambiguous();
    if (
      run.finalStatus === 'AMBIGUOUS' ||
      run.investigationRequired ||
      run.outbox?.status === 'AMBIGUOUS' ||
      run.dispatch?.status === 'PROCESSING'
    ) {
      return this.ambiguous();
    }
    if (run.finalStatus === 'SENT' || run.dispatch?.status === 'SENT') {
      return { status: 'QUEUED' };
    }
    if (run.dispatch?.status === 'FAILED') {
      return {
        status: 'FAILED',
        failureCode: COMMERCIAL_EXECUTION_DISPATCH_FAILED,
      };
    }
    if (run.mode === 'DRY_RUN') {
      return !run.dispatchId && !run.jobId && !run.dispatch && !run.outbox
        ? {
            status: 'FAILED',
            failureCode: COMMERCIAL_EXECUTION_ABANDONED_SAFE,
          }
        : this.ambiguous();
    }
    if (!baseIdentitiesAreConsistent(context)) return this.ambiguous();
    if (run.dispatch!.attemptCount > 0) return this.ambiguous();
    if (run.outbox!.status === 'PUBLISHED' && run.jobId !== run.outbox!.jobId) {
      return this.ambiguous();
    }

    let job: CommercialDispatchJobEvidence | null;
    try {
      job = await this.dependencies.jobs.findJob(run.outbox!.jobId);
    } catch {
      return this.ambiguous();
    }
    const jobMatches =
      job?.id === run.outbox!.jobId &&
      job.dispatchId === run.outbox!.dispatchId;
    if (run.outbox!.status === 'PENDING') {
      if (job && !jobMatches) return this.ambiguous();
      throw new AppError(
        'Outbox comercial deve ser reconciliado antes da execucao',
        COMMERCIAL_OUTBOX_RECONCILIATION_REQUIRED,
      );
    }
    return jobMatches ? { status: 'QUEUED' } : this.ambiguous();
  }

  private ambiguous(): RecoveryDecision {
    return {
      status: 'AMBIGUOUS',
      failureCode: COMMERCIAL_EXECUTION_RECOVERY_AMBIGUOUS,
    };
  }

  private result(
    outcome: 'recovered' | 'already-terminal',
    execution: CommercialAutomationExecutionRecord,
    now: Date,
  ) {
    return {
      outcome,
      execution: sanitizeCommercialAutomationExecution(execution, now),
    };
  }
}
