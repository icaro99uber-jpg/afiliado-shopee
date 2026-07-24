import type { JobSchedulerJson } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BullMqPipelineScheduler,
  DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  JOB_NAMES,
  type BullMqPipelineSchedulerQueue,
  type PipelineProductJob,
  type SchedulerConfig,
} from './index';

const enabledConfig: SchedulerConfig = {
  enabled: true,
  cronExpression: '0 8 * * *',
  timezone: 'America/Sao_Paulo',
  filters: { categoria: 'Eletronicos', notaMin: 4.5 },
  jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
};

const createQueueMock = () => {
  let registered: JobSchedulerJson<PipelineProductJob> | undefined;

  const queue: BullMqPipelineSchedulerQueue = {
    upsertJobScheduler: vi.fn(async (jobId, repeatOptions, template) => {
      registered = {
        key: jobId,
        name: template.name,
        pattern: repeatOptions.pattern,
        tz: repeatOptions.tz,
        next: Date.UTC(2026, 6, 25, 11),
        template: { data: template.data },
      };
      return undefined;
    }),
    getJobScheduler: vi.fn(async () => registered),
    removeJobScheduler: vi.fn(async () => {
      const removed = registered !== undefined;
      registered = undefined;
      return removed;
    }),
  };

  return queue;
};

let queue: ReturnType<typeof createQueueMock>;

beforeEach(() => {
  queue = createQueueMock();
});

describe('BullMqPipelineScheduler', () => {
  it('nao agenda ao construir e respeita configuracao desativada', async () => {
    const scheduler = new BullMqPipelineScheduler(queue);

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    await expect(
      scheduler.register({
        enabled: false,
        jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      }),
    ).resolves.toMatchObject({ status: 'disabled', nextRunAt: null });
    expect(queue.getJobScheduler).not.toHaveBeenCalled();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('registra pipeline-product com cron, timezone e filters', async () => {
    const scheduler = new BullMqPipelineScheduler(queue);

    await expect(scheduler.register(enabledConfig)).resolves.toEqual({
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      status: 'registered',
      cronExpression: '0 8 * * *',
      timezone: 'America/Sao_Paulo',
      filters: { categoria: 'Eletronicos', notaMin: 4.5 },
      nextRunAt: '2026-07-25T11:00:00.000Z',
    });
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      { pattern: '0 8 * * *', tz: 'America/Sao_Paulo' },
      {
        name: JOB_NAMES.pipelineProduct,
        data: { filters: { categoria: 'Eletronicos', notaMin: 4.5 } },
      },
    );
  });

  it('nao duplica um agendamento equivalente', async () => {
    const scheduler = new BullMqPipelineScheduler(queue);

    await scheduler.register(enabledConfig);
    await scheduler.register(enabledConfig);

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('atualiza o mesmo jobId quando a configuracao muda', async () => {
    const scheduler = new BullMqPipelineScheduler(queue);

    await scheduler.register(enabledConfig);
    await scheduler.register({
      ...enabledConfig,
      cronExpression: '30 9 * * *',
    });

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenLastCalledWith(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      { pattern: '30 9 * * *', tz: 'America/Sao_Paulo' },
      expect.objectContaining({ name: JOB_NAMES.pipelineProduct }),
    );
  });

  it('remove o agendamento e retorna estado padronizado', async () => {
    const scheduler = new BullMqPipelineScheduler(queue);
    await scheduler.register(enabledConfig);

    await expect(
      scheduler.remove(DEFAULT_PIPELINE_SCHEDULER_JOB_ID),
    ).resolves.toEqual({
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      status: 'not-registered',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    });
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
    );
  });
});
