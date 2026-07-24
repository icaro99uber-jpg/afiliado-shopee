import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  createPrismaClient,
  type DatabaseClient,
} from '@shopee-auto-affiliate-ai/database';
import {
  maskEvolutionDestination,
  MockShopeeProvider,
  type HunterProvider,
} from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  createBullMqPipelineScheduler,
  createProductPipelineQueue,
  createRedisConnection,
  JOB_NAMES,
  type JobsOptions,
  type PipelineProductJob,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createApplicationServices,
  createPrismaRepositories,
} from './application-services';
import type { AnalyticsService } from './analytics-service';
import { SchedulerStatusService } from './scheduler-status-service';

type BuildAppOptions = {
  logger?: boolean;
  hunterProvider?: HunterProvider;
  prisma?: DatabaseClient;
  analyticsService?: Pick<AnalyticsService, 'getSnapshot'>;
  schedulerEnabled?: boolean;
  schedulerStatusServiceFactory?: () => Pick<
    SchedulerStatusService,
    'getStatus'
  >;
  pipelineQueue?: {
    add: (
      name: string,
      data: PipelineProductJob,
      opts?: JobsOptions,
    ) => Promise<{ id?: string | number }>;
    getJob?: (id: string) => Promise<PipelineJobLike | null | undefined>;
    close?: () => Promise<void>;
  };
  redisUrl?: string;
};

type PipelineJobLike = {
  id?: string | number;
  data?: PipelineProductJob;
  progress?: unknown;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  returnvalue?: unknown;
  failedReason?: string;
  getState: () => Promise<string>;
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
  const repositories = createPrismaRepositories(prisma);
  let redisConnection: ReturnType<typeof createRedisConnection> | undefined;
  let pipelineQueue = options.pipelineQueue;
  const getPipelineQueue = () => {
    if (!pipelineQueue) {
      redisConnection = createRedisConnection(
        options.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
      );
      pipelineQueue = createProductPipelineQueue(redisConnection);
    }
    return pipelineQueue as NonNullable<typeof pipelineQueue>;
  };
  let pipelineScheduler:
    | ReturnType<typeof createBullMqPipelineScheduler>
    | undefined;
  const schedulerReader = {
    getState: (jobId: string) => {
      pipelineScheduler ??= createBullMqPipelineScheduler(
        getPipelineQueue() as ReturnType<typeof createProductPipelineQueue>,
      );
      return pipelineScheduler.getState(jobId);
    },
  };
  const schedulerStatusService = options.schedulerStatusServiceFactory
    ? options.schedulerStatusServiceFactory()
    : new SchedulerStatusService(
        schedulerReader,
        options.schedulerEnabled ?? false,
      );
  const getApplicationServices = () =>
    createApplicationServices({
      repositories,
      hunterProvider,
      logger: app.log,
    });

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));

  app.get('/analytics', async (request, reply) => {
    try {
      const analyticsService =
        options.analyticsService ?? getApplicationServices().analytics;
      return await analyticsService.getSnapshot();
    } catch (error) {
      request.log.error(
        { event: 'analytics.route.failed', error },
        'Analytics route failed',
      );
      return reply.status(500).send({
        error: 'ANALYTICS_FETCH_FAILED',
        message: 'Falha ao consultar analytics',
      });
    }
  });

  app.get('/scheduler', async (request, reply) => {
    try {
      return await schedulerStatusService.getStatus();
    } catch (error) {
      request.log.error(
        {
          event: 'scheduler.status.route.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Scheduler status route failed',
      );
      return reply.status(503).send({
        error: 'SCHEDULER_STATUS_UNAVAILABLE',
        message: 'Estado do Scheduler indisponivel',
      });
    }
  });

  app.post('/hunter/run', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as ProductFilters;
      const filters: ProductFilters = {
        categoria:
          typeof body.categoria === 'string' ? body.categoria : undefined,
        precoMin: parseNumberFilter(body.precoMin, 'precoMin'),
        precoMax: parseNumberFilter(body.precoMax, 'precoMax'),
        descontoMin: parseNumberFilter(body.descontoMin, 'descontoMin'),
        notaMin: parseNumberFilter(body.notaMin, 'notaMin'),
        vendidosMin: parseNumberFilter(body.vendidosMin, 'vendidosMin'),
        comissaoMin: parseNumberFilter(body.comissaoMin, 'comissaoMin'),
      };

      return await getApplicationServices().hunter.run(filters);
    } catch (error) {
      request.log.error(
        { event: 'hunter.route.failed', error },
        'Hunter route failed',
      );
      if (error instanceof AppError && error.code === 'INVALID_HUNTER_FILTER') {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      return reply.status(500).send({
        error: 'HUNTER_RUN_FAILED',
        message: 'Falha ao executar Hunter Agent',
      });
    }
  });

  app.post('/score/run', async (request, reply) => {
    try {
      return await getApplicationServices().score.run();
    } catch (error) {
      request.log.error(
        { event: 'score.route.failed', error },
        'Score route failed',
      );
      return reply.status(500).send({
        error: 'SCORE_RUN_FAILED',
        message: 'Falha ao executar Score Engine',
      });
    }
  });

  app.post('/copy/generate', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { productId?: unknown };
      if (
        typeof body.productId !== 'string' ||
        body.productId.trim().length === 0
      ) {
        return reply.status(400).send({
          error: 'INVALID_PRODUCT_ID',
          message: 'productId é obrigatório',
        });
      }

      return await getApplicationServices().copy.generate(body.productId);
    } catch (error) {
      request.log.error(
        { event: 'copy.route.failed', error },
        'Copy route failed',
      );
      if (error instanceof AppError && error.code === 'PRODUCT_NOT_FOUND') {
        return reply
          .status(404)
          .send({ error: error.code, message: error.message });
      }
      return reply.status(500).send({
        error: 'COPY_GENERATE_FAILED',
        message: 'Falha ao gerar copy',
      });
    }
  });

  app.post('/pipeline/run', async (request, reply) => {
    const body = (request.body ?? {}) as PipelineProductJob;
    const queue = getPipelineQueue();
    const job = await queue.add(
      JOB_NAMES.pipelineProduct,
      { filters: body.filters },
      undefined,
    );
    return reply.status(202).send({ jobId: job.id, status: 'queued' });
  });

  app.get('/pipeline/jobs/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const queue = getPipelineQueue();
    const job = await queue.getJob?.(params.id);
    if (!job)
      return reply
        .status(404)
        .send({ error: 'JOB_NOT_FOUND', message: 'Job não encontrado' });
    return {
      status: await job.getState(),
      progress: job.progress,
      startedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      finishedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
      result: job.returnvalue ?? null,
      error: job.failedReason ?? null,
    };
  });

  app.post('/whatsapp/destinations', async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: unknown;
      destination?: unknown;
      active?: unknown;
    };
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply
        .status(400)
        .send({
          error: 'INVALID_DESTINATION_NAME',
          message: 'name é obrigatório',
        });
    }
    if (
      typeof body.destination !== 'string' ||
      body.destination.trim().length === 0
    ) {
      return reply
        .status(400)
        .send({
          error: 'INVALID_DESTINATION',
          message: 'destination é obrigatório',
        });
    }
    return repositories.whatsappDestinations.create({
      name: body.name.trim(),
      destination: body.destination.trim(),
      active: typeof body.active === 'boolean' ? body.active : true,
    });
  });

  app.get('/whatsapp/destinations', async () =>
    repositories.whatsappDestinations.list(),
  );

  app.patch('/whatsapp/destinations/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as {
      name?: unknown;
      destination?: unknown;
      active?: unknown;
    };
    const data: { name?: string; destination?: string; active?: boolean } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0)
        return reply
          .status(400)
          .send({
            error: 'INVALID_DESTINATION_NAME',
            message: 'name não pode ser vazio',
          });
      data.name = body.name.trim();
    }
    if (body.destination !== undefined) {
      if (
        typeof body.destination !== 'string' ||
        body.destination.trim().length === 0
      )
        return reply
          .status(400)
          .send({
            error: 'INVALID_DESTINATION',
            message: 'destination não pode ser vazio',
          });
      data.destination = body.destination.trim();
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean')
        return reply
          .status(400)
          .send({
            error: 'INVALID_ACTIVE',
            message: 'active deve ser boolean',
          });
      data.active = body.active;
    }
    const updated = await repositories.whatsappDestinations.update(
      params.id,
      data,
    );
    if (!updated) {
      return reply
        .status(404)
        .send({
          error: 'DESTINATION_NOT_FOUND',
          message: 'Destino não encontrado',
        });
    }
    return updated;
  });

  app.get('/whatsapp/dispatches', async (request) => {
    const query = request.query as {
      status?: string;
      destinationId?: string;
      productId?: string;
    };
    return repositories.whatsappDispatches.list({
      status: query.status,
      destinationId: query.destinationId,
      productId: query.productId,
    });
  });

  app.get('/whatsapp/dispatches/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const dispatch =
      await repositories.whatsappDispatches.findByIdWithDetails(params.id);
    if (!dispatch)
      return reply
        .status(404)
        .send({ error: 'DISPATCH_NOT_FOUND', message: 'Envio não encontrado' });
    return {
      ...dispatch,
      destination: {
        ...dispatch.destination,
        destination: maskEvolutionDestination(dispatch.destination.destination),
      },
    };
  });

  app.addHook('onClose', async () => {
    await pipelineQueue?.close?.();
    await redisConnection?.quit();
    if (!options.prisma) await prisma.$disconnect();
  });

  return app;
};
