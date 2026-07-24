import { describe, expect, it, vi } from 'vitest';
import {
  JOB_NAMES,
  type PipelineProductJob,
} from '@shopee-auto-affiliate-ai/queue';
import { MockShopeeProvider } from '@shopee-auto-affiliate-ai/providers';
import { processPipelineProductJob } from '../src/index';

const createPrismaMock = (fail = false) => {
  const store = new Map<string, unknown>();
  return {
    $disconnect: vi.fn(),
    productLead: {
      findUnique: vi.fn(
        async ({ where }: { where: { providerProductId?: string } }) =>
          where.providerProductId && store.has(where.providerProductId)
            ? { id: where.providerProductId }
            : null,
      ),
      create: vi.fn(
        async ({ data }: { data: { providerProductId: string } }) => {
          if (fail) throw new Error('database unavailable');
          store.set(data.providerProductId, data);
          return data;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { providerProductId?: string; id?: string };
          data: unknown;
        }) => {
          store.set(where.providerProductId ?? where.id ?? 'unknown', data);
          return data;
        },
      ),
      findMany: vi.fn(async () =>
        Array.from(store.values()).map((value) => ({
          id: (value as { providerProductId: string }).providerProductId,
          ...(value as object),
        })),
      ),
    },
  };
};

const createJob = (data: PipelineProductJob) => ({
  id: 'job-1',
  name: JOB_NAMES.pipelineProduct,
  data,
  updateProgress: vi.fn(async () => undefined),
});

const logger = { info: vi.fn(), error: vi.fn() };

describe('pipeline-product worker', () => {
  it('processa o pipeline e atualiza progresso', async () => {
    const job = createJob({ filters: { categoria: 'Casa' } });
    const result = await processPipelineProductJob(job as never, {
      prisma: createPrismaMock() as never,
      hunterProvider: new MockShopeeProvider(),
      logger,
    });

    expect(result).toMatchObject({
      hunter: { encontrados: 5, novos: 5 },
      score: { produtosProcessados: 5 },
    });
    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 100);
  });

  it('registra falha quando o pipeline falha', async () => {
    const job = createJob({ filters: { categoria: 'Casa' } });

    await expect(
      processPipelineProductJob(job as never, {
        prisma: createPrismaMock(true) as never,
        hunterProvider: new MockShopeeProvider(),
        logger,
      }),
    ).rejects.toThrow('database unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pipeline.job.failed', jobId: 'job-1' }),
      'Pipeline falhou',
    );
  });
});
