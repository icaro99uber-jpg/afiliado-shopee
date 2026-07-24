import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createPrismaClient, type DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import { MockShopeeProvider, type HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { HunterService } from './hunter-service';
import { ScoreService } from './score-service';

type BuildAppOptions = {
  logger?: boolean;
  hunterProvider?: HunterProvider;
  prisma?: DatabaseClient;
};

const parseNumberFilter = (value: unknown, field: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new AppError(`Filtro inválido: ${field}`, 'INVALID_HUNTER_FILTER');
  }
  return value;
};

export const buildApp = async (options: BuildAppOptions = {}) => {
  const app = Fastify({ logger: options.logger ?? true });
  const prisma = options.prisma ?? createPrismaClient();
  const hunterProvider = options.hunterProvider ?? new MockShopeeProvider();

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));

  app.post('/hunter/run', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as ProductFilters;
      const filters: ProductFilters = {
        categoria: typeof body.categoria === 'string' ? body.categoria : undefined,
        precoMin: parseNumberFilter(body.precoMin, 'precoMin'),
        precoMax: parseNumberFilter(body.precoMax, 'precoMax'),
        descontoMin: parseNumberFilter(body.descontoMin, 'descontoMin'),
        notaMin: parseNumberFilter(body.notaMin, 'notaMin'),
        vendidosMin: parseNumberFilter(body.vendidosMin, 'vendidosMin'),
        comissaoMin: parseNumberFilter(body.comissaoMin, 'comissaoMin'),
      };

      const service = new HunterService({ provider: hunterProvider, prisma, logger: app.log });
      return await service.run(filters);
    } catch (error) {
      request.log.error({ event: 'hunter.route.failed', error }, 'Hunter route failed');
      if (error instanceof AppError && error.code === 'INVALID_HUNTER_FILTER') {
        return reply.status(400).send({ error: error.code, message: error.message });
      }
      return reply.status(500).send({ error: 'HUNTER_RUN_FAILED', message: 'Falha ao executar Hunter Agent' });
    }
  });

  app.post('/score/run', async (request, reply) => {
    try {
      const service = new ScoreService({ prisma, logger: app.log });
      return await service.run();
    } catch (error) {
      request.log.error({ event: 'score.route.failed', error }, 'Score route failed');
      return reply.status(500).send({ error: 'SCORE_RUN_FAILED', message: 'Falha ao executar Score Engine' });
    }
  });

  app.addHook('onClose', async () => {
    if (!options.prisma) await prisma.$disconnect();
  });

  return app;
};
