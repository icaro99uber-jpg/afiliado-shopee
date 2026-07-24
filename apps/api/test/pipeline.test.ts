import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { buildApp } from '../src/app';
import { PipelineService } from '../src/pipeline-service';

const createProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'provider-1',
  nome: 'Produto Aprovado',
  categoria: 'Eletrônicos',
  preco: 100,
  desconto: 100,
  nota: 5,
  vendidos: 10000,
  comissao: 0.2,
  loja: 'Shopee Oficial',
  urlImagem: 'https://example.com/image.jpg',
  url: 'https://example.com/product',
  ...overrides,
});

type StoredProduct = {
  id: string;
  providerProductId: string;
  nome: string;
  categoria: string;
  preco: number;
  desconto: number;
  nota: number;
  vendidos: number;
  comissao: number;
  loja: string;
  urlImagem: string;
  url?: string;
  title: string;
  score: number | null;
  scoreUpdatedAt: Date | null;
};

const toStoredProduct = (product: Product, id = product.id): StoredProduct => ({
  id,
  providerProductId: product.id,
  nome: product.nome,
  categoria: product.categoria,
  preco: product.preco,
  desconto: product.desconto,
  nota: product.nota,
  vendidos: product.vendidos,
  comissao: product.comissao,
  loja: product.loja,
  urlImagem: product.urlImagem,
  url: product.url,
  title: product.nome,
  score: null as number | null,
  scoreUpdatedAt: null as Date | null,
});

const createProvider = (products: Product[]) => ({
  buscarProdutos: vi.fn(async () => products),
});

const createPrismaMock = () => {
  const products = new Map<string, StoredProduct>();
  let productSequence = 1;

  return {
    $disconnect: vi.fn(),
    productLead: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { id?: string; providerProductId?: string };
        }) => {
          if (where.id) return products.get(where.id) ?? null;
          return (
            [...products.values()].find(
              (product) =>
                product.providerProductId === where.providerProductId,
            ) ?? null
          );
        },
      ),
      findMany: vi.fn(
        async (args?: { where?: { score?: { gte?: number } } }) => {
          const allProducts = [...products.values()];
          const minScore = args?.where?.score?.gte;
          if (minScore === undefined) return allProducts;
          return allProducts.filter(
            (product) => (product.score ?? -1) >= minScore,
          );
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<StoredProduct, 'id' | 'score' | 'scoreUpdatedAt'>;
        }) => {
          const product = {
            ...data,
            id: `product-${productSequence++}`,
            score: null,
            scoreUpdatedAt: null,
          };
          products.set(product.id, product);
          return product;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; providerProductId?: string };
          data: Partial<StoredProduct>;
        }) => {
          const current = where.id
            ? products.get(where.id)
            : [...products.values()].find(
                (product) =>
                  product.providerProductId === where.providerProductId,
              );
          if (!current) throw new Error('Product not found');
          const updated = { ...current, ...data };
          products.set(updated.id, updated);
          return updated;
        },
      ),
    },
    generatedCopy: {
      create: vi.fn(async ({ data }: { data: unknown }) => ({
        id: 'copy-1',
        ...data,
      })),
    },
  };
};

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('PipelineService', () => {
  it('executa o pipeline completo e expõe POST /pipeline/run', async () => {
    const provider = createProvider([
      createProduct({ id: 'approved-1' }),
      createProduct({
        id: 'rejected-1',
        comissao: 0,
        nota: 1,
        vendidos: 0,
        desconto: 0,
        loja: 'Loja Parceira',
      }),
    ]);
    const prisma = createPrismaMock();
    const app = await buildApp({
      logger: false,
      prisma: prisma as never,
      hunterProvider: provider,
    });

    const response = await app.inject({ method: 'POST', url: '/pipeline/run' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      produtosEncontrados: 2,
      produtosPontuados: 2,
      produtosAprovados: 1,
      copiesGeradas: 1,
      tempoExecucao: expect.stringMatching(/ms$/),
    });
    expect(prisma.generatedCopy.create).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('retorna relatório zerado quando nenhum produto é encontrado', async () => {
    const service = new PipelineService({
      provider: createProvider([]),
      prisma: createPrismaMock() as never,
      logger: logger(),
    });
    await expect(service.run()).resolves.toMatchObject({
      produtosEncontrados: 0,
      produtosPontuados: 0,
      produtosAprovados: 0,
      copiesGeradas: 0,
    });
  });

  it('não gera copies quando todos os produtos são reprovados', async () => {
    const prisma = createPrismaMock();
    const service = new PipelineService({
      provider: createProvider([
        createProduct({
          comissao: 0,
          nota: 1,
          vendidos: 0,
          desconto: 0,
          loja: 'Loja Parceira',
        }),
      ]),
      prisma: prisma as never,
      logger: logger(),
    });
    const report = await service.run();
    expect(report).toMatchObject({
      produtosEncontrados: 1,
      produtosPontuados: 1,
      produtosAprovados: 0,
      copiesGeradas: 0,
    });
    expect(prisma.generatedCopy.create).not.toHaveBeenCalled();
  });

  it('gera copies para todos os produtos aprovados', async () => {
    const prisma = createPrismaMock();
    const service = new PipelineService({
      provider: createProvider([
        createProduct({ id: 'approved-1' }),
        createProduct({ id: 'approved-2', nome: 'Produto B' }),
      ]),
      prisma: prisma as never,
      logger: logger(),
    });
    const report = await service.run();
    expect(report).toMatchObject({
      produtosEncontrados: 2,
      produtosPontuados: 2,
      produtosAprovados: 2,
      copiesGeradas: 2,
    });
    expect(prisma.generatedCopy.create).toHaveBeenCalledTimes(2);
  });

  it('trata erro no Hunter', async () => {
    const service = new PipelineService({
      provider: createProvider([]),
      prisma: createPrismaMock() as never,
      logger: logger(),
      hunterService: {
        run: vi.fn(async () => {
          throw new AppError('Hunter falhou', 'HUNTER_RUN_FAILED');
        }),
      },
    });
    await expect(service.run()).rejects.toMatchObject({
      code: 'HUNTER_RUN_FAILED',
    });
  });

  it('trata erro no Score', async () => {
    const service = new PipelineService({
      provider: createProvider([]),
      prisma: createPrismaMock() as never,
      logger: logger(),
      hunterService: {
        run: vi.fn(async () => ({
          encontrados: 1,
          novos: 1,
          atualizados: 0,
          tempoExecucao: '1ms',
        })),
      },
      scoreService: {
        run: vi.fn(async () => {
          throw new AppError('Score falhou', 'SCORE_RUN_FAILED');
        }),
      },
    });
    await expect(service.run()).rejects.toMatchObject({
      code: 'SCORE_RUN_FAILED',
    });
  });

  it('trata erro no Copy', async () => {
    const prisma = createPrismaMock();
    await prisma.productLead.create({
      data: toStoredProduct(createProduct(), 'product-1') as never,
    });
    await prisma.productLead.update({
      where: { id: 'product-1' },
      data: { score: 100 },
    });
    const service = new PipelineService({
      provider: createProvider([]),
      prisma: prisma as never,
      logger: logger(),
      hunterService: {
        run: vi.fn(async () => ({
          encontrados: 1,
          novos: 1,
          atualizados: 0,
          tempoExecucao: '1ms',
        })),
      },
      scoreService: {
        run: vi.fn(async () => ({
          produtosProcessados: 1,
          maiorScore: 100,
          menorScore: 100,
          mediaScore: 100,
          tempoExecucao: '1ms',
        })),
      },
      copyService: {
        generate: vi.fn(async () => {
          throw new AppError('Copy falhou', 'COPY_GENERATE_FAILED');
        }),
      },
    });
    await expect(service.run()).rejects.toMatchObject({
      code: 'COPY_GENERATE_FAILED',
    });
  });
});
