import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIPELINE_SCHEDULER_JOB_ID } from '@shopee-auto-affiliate-ai/queue';
import { SchedulerStatusService } from '../src/scheduler-status-service';

const createScheduler = () => ({
  register: vi.fn(),
  remove: vi.fn(),
  getState: vi.fn(),
});

describe('SchedulerStatusService', () => {
  it('retorna disabled pela configuracao e consulta somente o ID conhecido', async () => {
    const scheduler = createScheduler();
    scheduler.getState.mockResolvedValue({
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      status: 'not-registered',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    });
    const service = new SchedulerStatusService(scheduler, false);

    await expect(service.getStatus()).resolves.toEqual({
      enabled: false,
      status: 'disabled',
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      queue: 'product-pipeline',
      jobName: 'pipeline-product',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    });
    expect(scheduler.getState).toHaveBeenCalledWith(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
    );
    expect(scheduler.register).not.toHaveBeenCalled();
    expect(scheduler.remove).not.toHaveBeenCalled();
  });

  it('retorna estado registered com cron, timezone e nextRunAt ISO', async () => {
    const scheduler = createScheduler();
    scheduler.getState.mockResolvedValue({
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      status: 'registered',
      cronExpression: '0 8 * * *',
      timezone: 'America/Sao_Paulo',
      nextRunAt: '2026-07-25T11:00:00.000Z',
    });
    const service = new SchedulerStatusService(scheduler, true);

    await expect(service.getStatus()).resolves.toEqual({
      enabled: true,
      status: 'registered',
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      queue: 'product-pipeline',
      jobName: 'pipeline-product',
      cronExpression: '0 8 * * *',
      timezone: 'America/Sao_Paulo',
      nextRunAt: '2026-07-25T11:00:00.000Z',
    });
  });

  it('retorna not-registered sem inventar proxima execucao', async () => {
    const scheduler = createScheduler();
    scheduler.getState.mockResolvedValue({
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      status: 'not-registered',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    });
    const service = new SchedulerStatusService(scheduler, true);

    await expect(service.getStatus()).resolves.toMatchObject({
      enabled: true,
      status: 'not-registered',
      nextRunAt: null,
    });
  });
});
