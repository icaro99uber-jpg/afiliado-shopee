import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  type CommercialPipelineConfirmationService,
} from './commercial-pipeline-confirmation-service';
import {
  COMMERCIAL_EXECUTION_IN_PROGRESS,
  type CommercialAutomationPolicyService,
} from './commercial-automation-policy-service';
import {
  toCommercialAutomationProviderSource,
  toPersistedCommercialAutomationMode,
  toPublicCommercialAutomationMode,
  toPublicCommercialAutomationStatus,
  type CommercialAutomationMode,
  type CommercialAutomationProvider,
  type CommercialAutomationPublicStatus,
} from './commercial-automation-execution-domain';
import type { CommercialPipelineService } from './commercial-pipeline-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRepository,
  CommercialPipelineRunRepository,
} from './repositories';

export const COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED =
  'COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED';

export type { CommercialAutomationMode, CommercialAutomationProvider };

type CommercialAutomationLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

export type CommercialAutomationTickResult = {
  executionId: string;
  mode: CommercialAutomationMode;
  status: CommercialAutomationPublicStatus;
  reasons: string[];
  commercialRunId: string | null;
  dispatchCreated: boolean;
  whatsappJobCreated: boolean;
  messageSent: false;
};

const publicResult = (
  execution: CommercialAutomationExecutionRecord,
): CommercialAutomationTickResult => ({
  executionId: execution.id,
  mode: toPublicCommercialAutomationMode(execution.mode),
  status: toPublicCommercialAutomationStatus(execution.status),
  reasons: execution.reasons,
  commercialRunId: execution.commercialRunId,
  dispatchCreated: execution.status === 'QUEUED',
  whatsappJobCreated: execution.status === 'QUEUED',
  messageSent: false,
});

const safeFailureCode = (error: unknown) =>
  error instanceof AppError ? error.code : 'COMMERCIAL_AUTOMATION_TICK_FAILED';

export class CommercialAutomationOrchestrator {
  private readonly clock: () => Date;

  constructor(
    private readonly dependencies: {
      policy: Pick<
        CommercialAutomationPolicyService,
        'evaluateAutomationReadiness'
      >;
      syncOffers: { run(): Promise<unknown> };
      pipeline: Pick<CommercialPipelineService, 'dryRun'>;
      confirmation: Pick<CommercialPipelineConfirmationService, 'confirm'>;
      commercialRuns: Pick<CommercialPipelineRunRepository, 'findById'>;
      executions: CommercialAutomationExecutionRepository;
      logger: CommercialAutomationLogger;
      clock?: () => Date;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async executeTick(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationMode;
    provider: CommercialAutomationProvider;
  }): Promise<CommercialAutomationTickResult> {
    const mode = toPersistedCommercialAutomationMode(input.mode);
    const started = await this.dependencies.executions.start({
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId,
      mode,
      startedAt: this.clock(),
    });
    if (started.outcome === 'existing') {
      if (started.execution.status === 'STARTED') {
        throw new AppError(
          'Execucao comercial anterior permanece em andamento',
          COMMERCIAL_EXECUTION_IN_PROGRESS,
        );
      }
      return publicResult(started.execution);
    }
    if (started.outcome === 'concurrent') {
      return publicResult(
        await this.dependencies.executions.createBlocked({
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          mode,
          reasons: [COMMERCIAL_EXECUTION_IN_PROGRESS],
          completedAt: this.clock(),
        }),
      );
    }

    const execution = started.execution;
    let commercialRunId: string | undefined;
    let confirmationAttempted = false;
    try {
      const readiness =
        await this.dependencies.policy.evaluateAutomationReadiness();
      if (!readiness.allowed) {
        return publicResult(
          await this.dependencies.executions.finish(execution.id, {
            status: 'BLOCKED',
            reasons: readiness.reasons,
            completedAt: this.clock(),
          }),
        );
      }
      if (input.mode === 'send' && input.provider !== 'official') {
        return publicResult(
          await this.dependencies.executions.finish(execution.id, {
            status: 'BLOCKED',
            reasons: [COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED],
            failureCode: COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED,
            completedAt: this.clock(),
          }),
        );
      }

      await this.dependencies.syncOffers.run();
      const dryRun = await this.dependencies.pipeline.dryRun({
        source: toCommercialAutomationProviderSource(input.provider),
        campaign: 'commercial-automation',
      });
      commercialRunId = dryRun.runId;
      if (input.mode === 'preview') {
        return publicResult(
          await this.dependencies.executions.finish(execution.id, {
            status: 'PREVIEW_READY',
            commercialRunId,
            completedAt: this.clock(),
          }),
        );
      }

      const confirmationReadiness =
        await this.dependencies.policy.evaluateAutomationReadiness();
      if (!confirmationReadiness.allowed) {
        return publicResult(
          await this.dependencies.executions.finish(execution.id, {
            status: 'BLOCKED',
            reasons: confirmationReadiness.reasons,
            commercialRunId,
            completedAt: this.clock(),
          }),
        );
      }

      confirmationAttempted = true;
      await this.dependencies.confirmation.confirm(
        commercialRunId,
        COMMERCIAL_CONFIRMATION_TOKEN,
      );
      return publicResult(
        await this.dependencies.executions.finish(execution.id, {
          status: 'QUEUED',
          commercialRunId,
          completedAt: this.clock(),
        }),
      );
    } catch (error) {
      const failureCode = safeFailureCode(error);
      let status: 'FAILED' | 'AMBIGUOUS' = 'FAILED';
      if (confirmationAttempted && commercialRunId) {
        try {
          const run =
            await this.dependencies.commercialRuns.findById(commercialRunId);
          if (
            !run ||
            run.investigationRequired ||
            run.finalStatus === 'AMBIGUOUS' ||
            run.finalStatus === 'PENDING'
          ) {
            status = 'AMBIGUOUS';
          }
        } catch {
          status = 'AMBIGUOUS';
        }
      }
      this.dependencies.logger.error(
        {
          event: 'commercial-automation.tick.failed',
          executionId: execution.id,
          failureCode,
          status,
        },
        'Commercial automation tick failed',
      );
      return publicResult(
        await this.dependencies.executions.finish(execution.id, {
          status,
          commercialRunId,
          failureCode,
          completedAt: this.clock(),
        }),
      );
    } finally {
      this.dependencies.logger.info(
        {
          event: 'commercial-automation.tick.finished',
          executionId: execution.id,
          mode: input.mode,
        },
        'Commercial automation tick finished',
      );
    }
  }
}
