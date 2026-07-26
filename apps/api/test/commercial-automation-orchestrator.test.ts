import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED,
  CommercialAutomationOrchestrator,
} from '../src/commercial-automation-orchestrator';
import { COMMERCIAL_EXECUTION_IN_PROGRESS } from '../src/commercial-automation-policy-service';
import type {
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionRepository,
  CommercialAutomationExecutionStatus,
} from '../src/repositories';

const NOW = new Date('2026-07-26T15:00:00.000Z');

class MemoryExecutions implements CommercialAutomationExecutionRepository {
  records: CommercialAutomationExecutionRecord[] = [];
  concurrent = false;

  async start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: 'PREVIEW' | 'SEND';
    startedAt: Date;
  }) {
    const existing = this.records.find(
      (record) => input.bullMqJobId && record.bullMqJobId === input.bullMqJobId,
    );
    if (existing) return { outcome: 'existing' as const, execution: existing };
    if (this.concurrent) return { outcome: 'concurrent' as const };
    const execution: CommercialAutomationExecutionRecord = {
      id: `execution-${this.records.length + 1}`,
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId ?? null,
      mode: input.mode,
      status: 'STARTED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: input.startedAt,
      completedAt: null,
    };
    this.records.push(execution);
    return { outcome: 'created' as const, execution };
  }

  async createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: 'PREVIEW' | 'SEND';
    reasons: string[];
    completedAt: Date;
  }) {
    const execution: CommercialAutomationExecutionRecord = {
      id: `execution-${this.records.length + 1}`,
      schedulerJobId: input.schedulerJobId,
      bullMqJobId: input.bullMqJobId ?? null,
      mode: input.mode,
      status: 'BLOCKED',
      reasons: input.reasons,
      commercialRunId: null,
      failureCode: null,
      startedAt: input.completedAt,
      completedAt: input.completedAt,
    };
    this.records.push(execution);
    return execution;
  }

  async finish(
    id: string,
    input: {
      status: Exclude<CommercialAutomationExecutionStatus, 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const index = this.records.findIndex((record) => record.id === id);
    this.records[index] = {
      ...this.records[index],
      ...input,
      reasons: input.reasons ?? this.records[index].reasons,
      commercialRunId:
        input.commercialRunId ?? this.records[index].commercialRunId,
      failureCode: input.failureCode ?? this.records[index].failureCode,
    };
    return this.records[index];
  }

  async list() {
    return { items: this.records, total: this.records.length };
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }
}

const createSubject = () => {
  const executions = new MemoryExecutions();
  const policy = {
    evaluateAutomationReadiness: vi.fn(async () => ({
      allowed: true,
      reasons: [] as string[],
    })),
  };
  const syncOffers = { run: vi.fn(async () => ({ synced: 1 })) };
  const pipeline = {
    dryRun: vi.fn(async () => ({ runId: 'run-1' })),
  };
  const confirmation = { confirm: vi.fn(async () => ({ status: 'queued' })) };
  const commercialRuns = {
    findById: vi.fn(
      async (): Promise<{
        finalStatus: 'AMBIGUOUS' | null;
        investigationRequired: boolean;
      }> => ({
        finalStatus: null,
        investigationRequired: false,
      }),
    ),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const orchestrator = new CommercialAutomationOrchestrator({
    policy: policy as never,
    syncOffers,
    pipeline: pipeline as never,
    confirmation: confirmation as never,
    commercialRuns: commercialRuns as never,
    executions,
    logger,
    clock: () => NOW,
  });
  return {
    orchestrator,
    executions,
    policy,
    syncOffers,
    pipeline,
    confirmation,
    commercialRuns,
  };
};

const tick = {
  schedulerJobId: 'scheduled-commercial-automation',
  bullMqJobId: 'bull-job-1',
  mode: 'preview' as const,
  provider: 'mock' as const,
};

describe('CommercialAutomationOrchestrator', () => {
  it('registra BLOCKED e nao sincroniza nem executa pipeline quando o guardrail bloqueia', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness.mockResolvedValue({
      allowed: false,
      reasons: ['AUTOMATION_PAUSED'],
    });

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'blocked',
        reasons: ['AUTOMATION_PAUSED'],
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      },
    );
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it('bloqueia um segundo tick quando existe execucao concorrente', async () => {
    const subject = createSubject();
    subject.executions.concurrent = true;

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'blocked',
        reasons: [COMMERCIAL_EXECUTION_IN_PROGRESS],
      },
    );
    expect(subject.policy.evaluateAutomationReadiness).not.toHaveBeenCalled();
  });

  it('sincroniza e executa exatamente um dry-run no modo preview sem confirmar', async () => {
    const subject = createSubject();

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'preview-ready',
        commercialRunId: 'run-1',
        dispatchCreated: false,
        whatsappJobCreated: false,
        messageSent: false,
      },
    );
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledWith({
      source: 'MOCK',
      campaign: 'commercial-automation',
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });

  it.each(['mock', 'manual'] as const)(
    'bloqueia send com provider %s antes do sync',
    async (provider) => {
      const subject = createSubject();

      await expect(
        subject.orchestrator.executeTick({
          ...tick,
          mode: 'send',
          provider,
        }),
      ).resolves.toMatchObject({
        status: 'blocked',
        reasons: [COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED],
      });
      expect(subject.syncOffers.run).not.toHaveBeenCalled();
      expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
      expect(subject.confirmation.confirm).not.toHaveBeenCalled();
    },
  );

  it('confirma uma unica vez no modo send official totalmente mockado', async () => {
    const subject = createSubject();

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'queued',
      dispatchCreated: true,
      whatsappJobCreated: true,
      messageSent: false,
    });
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledWith({
      source: 'OFFICIAL',
      campaign: 'commercial-automation',
    });
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('nao duplica execucao nem efeitos para a mesma job ID', async () => {
    const subject = createSubject();
    const first = await subject.orchestrator.executeTick(tick);
    const second = await subject.orchestrator.executeTick(tick);

    expect(second).toEqual(first);
    expect(subject.executions.records).toHaveLength(1);
    expect(subject.syncOffers.run).toHaveBeenCalledOnce();
    expect(subject.pipeline.dryRun).toHaveBeenCalledOnce();
  });

  it('nao conclui como sucesso uma reentrega cuja execucao continua STARTED', async () => {
    const subject = createSubject();
    subject.executions.records.push({
      id: 'execution-started',
      schedulerJobId: tick.schedulerJobId,
      bullMqJobId: tick.bullMqJobId,
      mode: 'PREVIEW',
      status: 'STARTED',
      reasons: [],
      commercialRunId: null,
      failureCode: null,
      startedAt: NOW,
      completedAt: null,
    });

    await expect(subject.orchestrator.executeTick(tick)).rejects.toMatchObject({
      code: COMMERCIAL_EXECUTION_IN_PROGRESS,
    });
    expect(subject.syncOffers.run).not.toHaveBeenCalled();
  });

  it('finaliza FAILED quando a sincronizacao falha antes do dry-run', async () => {
    const subject = createSubject();
    subject.syncOffers.run.mockRejectedValue(new Error('offline'));

    await expect(subject.orchestrator.executeTick(tick)).resolves.toMatchObject(
      {
        status: 'failed',
        commercialRunId: null,
      },
    );
    expect(subject.pipeline.dryRun).not.toHaveBeenCalled();
  });

  it('finaliza AMBIGUOUS quando a confirmacao entra em estado incerto', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(new Error('timeout'));
    subject.commercialRuns.findById.mockResolvedValue({
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'ambiguous',
      commercialRunId: 'run-1',
    });
    expect(subject.confirmation.confirm).toHaveBeenCalledOnce();
  });

  it('finaliza FAILED quando a confirmacao falha antes de criar estado incerto', async () => {
    const subject = createSubject();
    subject.confirmation.confirm.mockRejectedValue(
      new AppError('Produto mudou', 'COMMERCIAL_PRODUCT_CHANGED'),
    );

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('reavalia guardrails imediatamente antes de confirmar', async () => {
    const subject = createSubject();
    subject.policy.evaluateAutomationReadiness
      .mockResolvedValueOnce({ allowed: true, reasons: [] })
      .mockResolvedValueOnce({
        allowed: false,
        reasons: ['AUTOMATION_PAUSED'],
      });

    await expect(
      subject.orchestrator.executeTick({
        ...tick,
        mode: 'send',
        provider: 'official',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      reasons: ['AUTOMATION_PAUSED'],
      commercialRunId: 'run-1',
    });
    expect(subject.confirmation.confirm).not.toHaveBeenCalled();
  });
});
