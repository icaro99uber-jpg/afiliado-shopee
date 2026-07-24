import { describe, expect, it, vi } from 'vitest';
import {
  JOB_NAMES,
  type PipelineProductJob,
} from '@shopee-auto-affiliate-ai/queue';
import { processPipelineProductJob } from '../src/index';

const createProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 'product-1',
  providerProductId: 'provider-1',
  nome: 'Produto aprovado',
  categoria: 'Casa',
  preco: 100,
  desconto: 100,
  nota: 5,
  vendidos: 10000,
  comissao: 0.2,
  loja: 'Shopee Oficial',
  urlImagem: 'https://example.com/img.jpg',
  title: 'Produto aprovado',
  ...overrides,
});

const createPrismaMock = (fail = false) => {
  const store = new Map<string, ReturnType<typeof createProduct>>();
  const generatedCopies: unknown[] = [];

  return {
    $disconnect: vi.fn(),
    productLead: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { providerProductId?: string; id?: string };
        }) => {
          const products = Array.from(store.values());
          return (
            products.find(
              (product) =>
                (where.providerProductId &&
                  product.providerProductId === where.providerProductId) ||
                (where.id && product.id === where.id),
            ) ?? null
          );
        },
      ),
      create: vi.fn(
        async ({ data }: { data: ReturnType<typeof createProduct> }) => {
          if (fail) throw new Error('database unavailable');
          const product = createProduct({
            ...data,
            id: data.providerProductId,
          });
          store.set(product.providerProductId, product);
          return product;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { providerProductId?: string; id?: string };
          data: Record<string, unknown>;
        }) => {
          const product = Array.from(store.values()).find(
            (item) =>
              (where.providerProductId &&
                item.providerProductId === where.providerProductId) ||
              (where.id && item.id === where.id),
          );
          if (!product) return data;
          Object.assign(product, data);
          return product;
        },
      ),
      findMany: vi.fn(
        async (args?: { where?: { score?: { gte?: number } } }) => {
          const products = Array.from(store.values());
          const gte = args?.where?.score?.gte;
          return gte === undefined
            ? products
            : products.filter((product) => (product.score as number) >= gte);
        },
      ),
    },
    generatedCopy: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        generatedCopies.push(data);
        return { id: `copy-${generatedCopies.length}`, ...(data as object) };
      }),
    },
  };
};

const createHunterProvider = () => ({
  buscarProdutos: vi.fn(async () => [
    createProduct({
      id: 'approved',
      providerProductId: 'approved',
      nome: 'Produto aprovado',
    }),
    createProduct({
      id: 'rejected',
      providerProductId: 'rejected',
      nome: 'Produto reprovado',
      desconto: 0,
      nota: 1,
      vendidos: 0,
      comissao: 0,
      loja: 'Loja Parceira',
    }),
  ]),
});

const createJob = (data: PipelineProductJob) => ({
  id: 'job-1',
  name: JOB_NAMES.pipelineProduct,
  data,
  updateProgress: vi.fn(async () => undefined),
});

const logger = { info: vi.fn(), error: vi.fn() };

describe('pipeline-product worker', () => {
  it('executa Hunter, Score e Copy, gerando copy apenas para score >= 70', async () => {
    const job = createJob({ filters: { categoria: 'Casa' } });
    const prisma = createPrismaMock();
    const result = await processPipelineProductJob(job as never, {
      prisma: prisma as never,
      hunterProvider: createHunterProvider(),
      logger,
    });

    expect(result).toMatchObject({
      produtosEncontrados: 2,
      produtosPontuados: 2,
      produtosAprovados: 1,
      copiesGeradas: 1,
    });
    expect(prisma.generatedCopy.create).toHaveBeenCalledTimes(1);
    expect(prisma.generatedCopy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'approved' }),
    });
    expect(prisma.generatedCopy.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ productId: 'rejected' }),
    });
    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 100);
  });

  it('registra falha quando o pipeline falha', async () => {
    const job = createJob({ filters: { categoria: 'Casa' } });

    await expect(
      processPipelineProductJob(job as never, {
        prisma: createPrismaMock(true) as never,
        hunterProvider: createHunterProvider(),
        logger,
      }),
    ).rejects.toThrow('database unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pipeline.job.failed', jobId: 'job-1' }),
      'Pipeline falhou',
    );
  });
});
