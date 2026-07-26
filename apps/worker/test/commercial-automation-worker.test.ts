import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';

import {
  COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY,
  processCommercialAutomationJob,
  startCommercialAutomationWorker,
} from '../src/commercial-automation-worker';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
};

const createInfrastructure = () => {
  const scheduler = {
    register: vi.fn(async () => ({ status: 'registered' })),
    remove: vi.fn(async () => ({ status: 'not-registered' })),
    getState: vi.fn(),
  };
  return {
    scheduler,
    infrastructure: {
      connection: {},
      scheduler,
      confirmationQueue: {
        hasJob: vi.fn(async () => false),
        enqueue: vi.fn(async () => undefined),
      },
      close: vi.fn(async () => undefined),
    },
  };
};

describe('commercial automation worker bootstrap', () => {
  it('registra apenas o Scheduler comercial sem executar tick no bootstrap', async () => {
    const { scheduler, infrastructure } = createInfrastructure();
    const workerFactory = vi.fn(() => ({
      worker: { name: 'commercial-worker' },
      close: vi.fn(async () => undefined),
    }));
    const config = loadConfig({
      ...baseEnv,
      COMMERCIAL_SCHEDULER_ENABLED: 'true',
    });

    const runtime = await startCommercialAutomationWorker(config, {
      infrastructureFactory: () => infrastructure as never,
      workerFactory: workerFactory as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(scheduler.register).toHaveBeenCalledOnce();
    expect(scheduler.register).toHaveBeenCalledWith({
      enabled: true,
      cronExpression: '0 9 * * *',
      timezone: 'America/Sao_Paulo',
      mode: 'preview',
      jobId: 'scheduled-commercial-automation',
    });
    expect(scheduler.register).not.toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'scheduled-pipeline-product' }),
    );
    expect(workerFactory).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it('desabilitado remove somente o Scheduler comercial conhecido', async () => {
    const { scheduler, infrastructure } = createInfrastructure();
    const workerFactory = vi.fn(() => ({
      worker: {},
      close: vi.fn(async () => undefined),
    }));

    const runtime = await startCommercialAutomationWorker(loadConfig(baseEnv), {
      infrastructureFactory: () => infrastructure as never,
      workerFactory: workerFactory as never,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(scheduler.remove).toHaveBeenCalledOnce();
    expect(scheduler.remove).toHaveBeenCalledWith(
      DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    );
    expect(scheduler.remove).not.toHaveBeenCalledWith(
      'scheduled-pipeline-product',
    );
    await runtime.close();
  });

  it('usa concorrencia 1', () => {
    expect(COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY).toBe(1);
  });
});

describe('processCommercialAutomationJob', () => {
  it('ignora job desconhecido', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        { id: 'job-1', name: 'pipeline-product', data: { mode: 'preview' } },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
        },
      ),
    ).resolves.toEqual({ skipped: true });
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('processa somente commercial-automation-tick com identidade BullMQ', async () => {
    const executeTick = vi.fn(async () => ({ status: 'preview-ready' }));
    await processCommercialAutomationJob(
      {
        id: 'job-1',
        name: JOB_NAMES.commercialAutomationTick,
        data: { mode: 'preview' },
      },
      {
        orchestrator: { executeTick } as never,
        provider: 'mock',
        mode: 'preview',
      },
    );
    expect(executeTick).toHaveBeenCalledOnce();
    expect(executeTick).toHaveBeenCalledWith({
      schedulerJobId: 'scheduled-commercial-automation',
      bullMqJobId: 'job-1',
      mode: 'preview',
      provider: 'mock',
    });
  });

  it('falha fechado quando o job comercial nao possui identidade BullMQ', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        {
          id: undefined,
          name: JOB_NAMES.commercialAutomationTick,
          data: { mode: 'preview' },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_JOB_ID_REQUIRED',
    });
    expect(executeTick).not.toHaveBeenCalled();
  });

  it('bloqueia job cujo modo diverge da configuracao carregada', async () => {
    const executeTick = vi.fn();
    await expect(
      processCommercialAutomationJob(
        {
          id: 'job-stale-send',
          name: JOB_NAMES.commercialAutomationTick,
          data: { mode: 'send' },
        },
        {
          orchestrator: { executeTick } as never,
          provider: 'mock',
          mode: 'preview',
        },
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_JOB_MODE_MISMATCH',
    });
    expect(executeTick).not.toHaveBeenCalled();
  });
});
