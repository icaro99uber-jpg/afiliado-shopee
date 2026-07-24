import { describe, expect, it, vi } from 'vitest';
import { JOB_NAMES } from '@shopee-auto-affiliate-ai/queue';
import { buildApp } from '../src/app';

const createPrismaMock = () => ({ $disconnect: vi.fn() });

const createQueueMock = () => ({
  add: vi.fn(async () => ({ id: 'job-1' })),
  getJob: vi.fn(async () => ({
    progress: 100,
    processedOn: Date.UTC(2026, 0, 1, 10, 0, 0),
    finishedOn: Date.UTC(2026, 0, 1, 10, 0, 1),
    returnvalue: { ok: true },
    failedReason: undefined,
    getState: vi.fn(async () => 'completed'),
  })),
  close: vi.fn(async () => undefined),
});

describe('Pipeline BullMQ API', () => {
  it('cria o job pipeline-product sem executar o pipeline no endpoint', async () => {
    const pipelineQueue = createQueueMock();
    const app = await buildApp({
      logger: false,
      prisma: createPrismaMock() as never,
      pipelineQueue,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/pipeline/run',
      payload: { filters: { categoria: 'Eletrônicos' } },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId: 'job-1', status: 'queued' });
    expect(pipelineQueue.add).toHaveBeenCalledWith(
      JOB_NAMES.pipelineProduct,
      { filters: { categoria: 'Eletrônicos' } },
      undefined,
    );
    await app.close();
  });

  it('consulta status do job', async () => {
    const pipelineQueue = createQueueMock();
    const app = await buildApp({
      logger: false,
      prisma: createPrismaMock() as never,
      pipelineQueue,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/pipeline/jobs/job-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'completed',
      progress: 100,
      startedAt: '2026-01-01T10:00:00.000Z',
      finishedAt: '2026-01-01T10:00:01.000Z',
      result: { ok: true },
      error: null,
    });
    expect(pipelineQueue.getJob).toHaveBeenCalledWith('job-1');
    await app.close();
  });
});
