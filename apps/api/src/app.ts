import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  createPrismaClient,
  type DatabaseClient,
} from '@shopee-auto-affiliate-ai/database';
import {
  maskEvolutionDestination,
  MockShopeeProvider,
  MockShopeeAffiliateOfferProvider,
  ManualShopeeAffiliateOfferProvider,
  parseManualShopeeOffer,
  type ShopeeAffiliateOfferProvider,
  type ShopeeAffiliateOfferSource,
  type ShopeeProductOfferListInput,
  type WhatsAppGroupDirectoryProvider,
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
import {
  GroupDirectoryService,
  type WhatsAppGroupPublic,
} from './group-directory-service';
import { ShopeeOfferSyncService } from './shopee-offer-sync-service';

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
  groupDirectoryProvider?: WhatsAppGroupDirectoryProvider;
  groupInstanceName?: string;
  groupDirectoryService?: Pick<
    GroupDirectoryService,
    'sync' | 'list' | 'find' | 'setActive'
  >;
  shopeeOfferProvider?: ShopeeAffiliateOfferProvider;
  shopeeMaxOffersPerSync?: number;
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

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
) => {
  if (value === undefined || value === '') return fallback;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new AppError('Paginacao invalida', 'INVALID_PAGINATION');
  }
  return parsed;
};

const offerStatus = (offer: { unavailableAt?: Date; offerEndsAt?: Date }) =>
  offer.unavailableAt
    ? ('UNAVAILABLE' as const)
    : offer.offerEndsAt && offer.offerEndsAt <= new Date()
      ? ('EXPIRED' as const)
      : ('ACTIVE' as const);

export const sanitizeDispatchDestination = (destination: {
  destination: string;
  type?: 'INDIVIDUAL' | 'GROUP';
  active?: boolean;
  available?: boolean;
  fingerprint?: string | null;
  sourceInstanceName?: string | null;
}) =>
  destination.type === 'GROUP'
    ? {
        type: destination.type,
        active: destination.active ?? false,
        available: destination.available ?? false,
        fingerprint: destination.fingerprint,
        destination: destination.fingerprint,
      }
    : {
        ...destination,
        destination: maskEvolutionDestination(destination.destination),
      };

export const buildApp = async (options: BuildAppOptions = {}) => {
  const app = Fastify({ logger: options.logger ?? true });
  const prisma = options.prisma ?? createPrismaClient();
  const hunterProvider = options.hunterProvider ?? new MockShopeeProvider();
  const shopeeOfferProvider =
    options.shopeeOfferProvider ?? new MockShopeeAffiliateOfferProvider();
  const repositories = createPrismaRepositories(prisma);
  const groupDirectoryService =
    options.groupDirectoryService ??
    (options.groupDirectoryProvider && options.groupInstanceName
      ? new GroupDirectoryService({
          provider: options.groupDirectoryProvider,
          groups: repositories.whatsappGroups,
          instanceName: options.groupInstanceName,
          logger: app.log,
        })
      : undefined);
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
    ReturnType<typeof createBullMqPipelineScheduler> | undefined;
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
      shopeeOfferProvider,
      shopeeMaxOffersPerSync: options.shopeeMaxOffersPerSync ?? 20,
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

  app.post('/shopee/offers/sync', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const input: ShopeeProductOfferListInput = {
        keyword:
          typeof body.keyword === 'string' ? body.keyword.trim() : undefined,
        categoryId:
          typeof body.categoryId === 'string'
            ? body.categoryId.trim()
            : undefined,
        minPrice:
          typeof body.minPrice === 'string' || typeof body.minPrice === 'number'
            ? String(body.minPrice)
            : undefined,
        maxPrice:
          typeof body.maxPrice === 'string' || typeof body.maxPrice === 'number'
            ? String(body.maxPrice)
            : undefined,
        minCommissionRate: parseNumberFilter(
          body.minCommissionRate,
          'minCommissionRate',
        ),
        minDiscountRate: parseNumberFilter(
          body.minDiscountRate,
          'minDiscountRate',
        ),
        minRating: parseNumberFilter(body.minRating, 'minRating'),
        limit: parsePositiveInteger(
          body.limit,
          options.shopeeMaxOffersPerSync ?? 20,
          options.shopeeMaxOffersPerSync ?? 20,
        ),
      };
      return await getApplicationServices().shopeeOfferSync.run(input);
    } catch (error) {
      const code =
        error instanceof AppError ? error.code : 'SHOPEE_SYNC_FAILED';
      const status =
        code === 'SHOPEE_API_NOT_CONFIGURED' ||
        code === 'SHOPEE_API_TRANSPORT_PENDING'
          ? 503
          : code === 'SHOPEE_MANUAL_INPUT_REQUIRED' ||
              code === 'INVALID_PAGINATION' ||
              code === 'INVALID_HUNTER_FILTER'
            ? 400
            : 500;
      return reply.status(status).send({
        error: code,
        message:
          error instanceof AppError
            ? error.message
            : 'Falha ao sincronizar ofertas da Shopee',
      });
    }
  });

  app.get('/shopee/offers', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const page = parsePositiveInteger(query.page, 1, 100000);
      const limit = parsePositiveInteger(query.limit, 20, 100);
      const source = ['MOCK', 'MANUAL', 'OFFICIAL'].includes(
        String(query.source),
      )
        ? (query.source as ShopeeAffiliateOfferSource)
        : undefined;
      const status = ['ACTIVE', 'EXPIRED', 'UNAVAILABLE'].includes(
        String(query.status),
      )
        ? (query.status as 'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE')
        : undefined;
      const affiliateLink = ['present', 'missing'].includes(
        String(query.affiliateLink),
      )
        ? (query.affiliateLink as 'present' | 'missing')
        : undefined;
      const result = await repositories.shopeeOffers.listOffers({
        source,
        status,
        affiliateLink,
        keyword:
          typeof query.keyword === 'string'
            ? query.keyword.trim() || undefined
            : undefined,
        page,
        limit,
      });
      return {
        provider: shopeeOfferProvider.source.toLocaleLowerCase(),
        items: result.items.map((item) => ({
          ...item,
          status: offerStatus(item),
        })),
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      };
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_PAGINATION') {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/shopee/offers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const offer = await repositories.shopeeOffers.findOfferById(id);
    if (!offer) {
      return reply.status(404).send({
        error: 'OFFER_NOT_FOUND',
        message: 'Oferta nao encontrada',
      });
    }
    return { ...offer, status: offerStatus(offer) };
  });

  app.post('/shopee/offers/import/validate', async (request, reply) => {
    const body = request.body as unknown;
    const records = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && 'records' in body
        ? (body as { records: unknown }).records
        : [body];
    if (
      !Array.isArray(records) ||
      records.length === 0 ||
      records.length > 100
    ) {
      return reply.status(400).send({
        error: 'INVALID_MANUAL_SHOPEE_OFFER',
        message: 'Envie entre 1 e 100 ofertas para validacao',
      });
    }
    const valid: ReturnType<typeof parseManualShopeeOffer>[] = [];
    const errors: { index: number; message: string }[] = [];
    records.forEach((record, index) => {
      try {
        valid.push(parseManualShopeeOffer(record));
      } catch (error) {
        errors.push({
          index,
          message:
            error instanceof AppError ? error.message : 'Registro invalido',
        });
      }
    });
    return {
      valid: errors.length === 0,
      count: valid.length,
      errors,
      preview: valid.map((offer) => ({
        ...offer,
        fetchedAt: offer.fetchedAt.toISOString(),
        offerStartsAt: offer.offerStartsAt?.toISOString(),
        offerEndsAt: offer.offerEndsAt?.toISOString(),
      })),
    };
  });

  app.post('/shopee/offers/import', async (request, reply) => {
    const body = (request.body ?? {}) as {
      records?: unknown;
      confirm?: unknown;
    };
    if (body.confirm !== 'CONFIRMAR_IMPORTACAO') {
      return reply.status(400).send({
        error: 'SHOPEE_IMPORT_CONFIRMATION_REQUIRED',
        message: 'Confirmacao explicita obrigatoria',
      });
    }
    if (!Array.isArray(body.records) || body.records.length < 1) {
      return reply.status(400).send({
        error: 'INVALID_MANUAL_SHOPEE_OFFER',
        message: 'Informe ao menos uma oferta manual',
      });
    }
    try {
      const service = new ShopeeOfferSyncService({
        provider: new ManualShopeeAffiliateOfferProvider(body.records),
        offers: repositories.shopeeOffers,
        maxOffersPerSync: options.shopeeMaxOffersPerSync ?? 20,
        logger: app.log,
      });
      return await service.run({ limit: body.records.length });
    } catch (error) {
      return reply.status(400).send({
        error:
          error instanceof AppError
            ? error.code
            : 'INVALID_MANUAL_SHOPEE_OFFER',
        message:
          error instanceof AppError ? error.message : 'Oferta manual invalida',
      });
    }
  });

  app.post('/shopee/offers/:id/copy-preview', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await getApplicationServices().copyPreview.preview(id);
    } catch (error) {
      if (error instanceof AppError) {
        const status = error.code === 'OFFER_NOT_FOUND' ? 404 : 409;
        return reply
          .status(status)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/coupons', async () => getApplicationServices().coupons.list());

  app.get('/coupons/:id', async (request, reply) => {
    try {
      return await getApplicationServices().coupons.find(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return reply.status(404).send({
        error: 'COUPON_NOT_FOUND',
        message:
          error instanceof AppError ? error.message : 'Cupom nao encontrado',
      });
    }
  });

  app.post('/coupons', async (request, reply) => {
    try {
      const coupon = await getApplicationServices().coupons.create(
        (request.body ?? {}) as Record<string, unknown>,
      );
      return reply.status(201).send(coupon);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof AppError ? error.code : 'INVALID_COUPON',
        message: error instanceof AppError ? error.message : 'Cupom invalido',
      });
    }
  });

  app.patch('/coupons/:id', async (request, reply) => {
    try {
      return await getApplicationServices().coupons.update(
        (request.params as { id: string }).id,
        (request.body ?? {}) as Record<string, unknown>,
      );
    } catch (error) {
      const status =
        error instanceof AppError && error.code === 'COUPON_NOT_FOUND'
          ? 404
          : 400;
      return reply.status(status).send({
        error: error instanceof AppError ? error.code : 'INVALID_COUPON',
        message: error instanceof AppError ? error.message : 'Cupom invalido',
      });
    }
  });

  app.delete('/coupons/:id', async (request, reply) => {
    try {
      await getApplicationServices().coupons.delete(
        (request.params as { id: string }).id,
        (request.body ?? {}) && (request.body as { confirm?: unknown }).confirm,
      );
      return reply.status(204).send();
    } catch (error) {
      const status =
        error instanceof AppError && error.code === 'COUPON_NOT_FOUND'
          ? 404
          : 400;
      return reply.status(status).send({
        error: error instanceof AppError ? error.code : 'COUPON_DELETE_FAILED',
        message:
          error instanceof AppError ? error.message : 'Falha ao excluir cupom',
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
      return reply.status(400).send({
        error: 'INVALID_DESTINATION_NAME',
        message: 'name é obrigatório',
      });
    }
    if (
      typeof body.destination !== 'string' ||
      body.destination.trim().length === 0
    ) {
      return reply.status(400).send({
        error: 'INVALID_DESTINATION',
        message: 'destination é obrigatório',
      });
    }
    if (body.destination.trim().toLowerCase().endsWith('@g.us')) {
      return reply.status(400).send({
        error: 'GROUP_DESTINATION_REQUIRES_SYNC',
        message: 'Grupos devem ser descobertos pela sincronizacao segura',
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
        return reply.status(400).send({
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
        return reply.status(400).send({
          error: 'INVALID_DESTINATION',
          message: 'destination não pode ser vazio',
        });
      data.destination = body.destination.trim();
      if (data.destination.toLowerCase().endsWith('@g.us')) {
        return reply.status(400).send({
          error: 'GROUP_DESTINATION_REQUIRES_SYNC',
          message: 'Grupos devem ser descobertos pela sincronizacao segura',
        });
      }
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean')
        return reply.status(400).send({
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
      return reply.status(404).send({
        error: 'DESTINATION_NOT_FOUND',
        message: 'Destino não encontrado',
      });
    }
    return updated;
  });

  const unavailableGroupDirectory = (reply: {
    status(code: number): { send(payload: unknown): unknown };
  }) =>
    reply.status(503).send({
      error: 'WHATSAPP_GROUP_DIRECTORY_UNAVAILABLE',
      message: 'Diretorio de grupos indisponivel',
    });

  app.post('/whatsapp/groups/sync', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    try {
      return await groupDirectoryService.sync();
    } catch (error) {
      request.log.error(
        {
          event: 'whatsapp.groups.sync-route-failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
          code: error instanceof AppError ? error.code : 'UNKNOWN',
        },
        'WhatsApp group sync route failed',
      );
      return unavailableGroupDirectory(reply);
    }
  });

  const parseBooleanQuery = (value: unknown, field: string) => {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new AppError(
      `${field} deve ser true ou false`,
      'INVALID_GROUP_FILTER',
    );
  };

  app.get('/whatsapp/groups', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    try {
      const query = request.query as { active?: unknown; available?: unknown };
      return await groupDirectoryService.list({
        active: parseBooleanQuery(query.active, 'active'),
        available: parseBooleanQuery(query.available, 'available'),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_GROUP_FILTER') {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      return unavailableGroupDirectory(reply);
    }
  });

  app.get('/whatsapp/groups/:id', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    try {
      const params = request.params as { id: string };
      return await groupDirectoryService.find(params.id);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'WHATSAPP_GROUP_NOT_FOUND'
      ) {
        return reply
          .status(404)
          .send({ error: error.code, message: error.message });
      }
      return unavailableGroupDirectory(reply);
    }
  });

  app.patch('/whatsapp/groups/:id', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['active', 'confirm'].includes(key)) ||
      typeof body.active !== 'boolean' ||
      (body.confirm !== undefined && typeof body.confirm !== 'string')
    ) {
      return reply.status(400).send({
        error: 'INVALID_GROUP_UPDATE',
        message: 'Somente o campo active pode ser alterado',
      });
    }
    try {
      return (await groupDirectoryService.setActive(
        params.id,
        body.active,
        body.confirm as string | undefined,
      )) satisfies WhatsAppGroupPublic;
    } catch (error) {
      if (error instanceof AppError) {
        const status =
          error.code === 'WHATSAPP_GROUP_NOT_FOUND'
            ? 404
            : error.code === 'WHATSAPP_GROUP_UNAVAILABLE'
              ? 409
              : 400;
        return reply
          .status(status)
          .send({ error: error.code, message: error.message });
      }
      return unavailableGroupDirectory(reply);
    }
  });

  app.get('/whatsapp/dispatches', async (request) => {
    const query = request.query as {
      status?: string;
      destinationId?: string;
      productId?: string;
    };
    const dispatches = await repositories.whatsappDispatches.list({
      status: query.status,
      destinationId: query.destinationId,
      productId: query.productId,
    });
    return dispatches.map((dispatch) => ({
      ...dispatch,
      destination: sanitizeDispatchDestination(dispatch.destination),
    }));
  });

  app.get('/whatsapp/dispatches/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const dispatch = await repositories.whatsappDispatches.findByIdWithDetails(
      params.id,
    );
    if (!dispatch)
      return reply
        .status(404)
        .send({ error: 'DISPATCH_NOT_FOUND', message: 'Envio não encontrado' });
    return {
      ...dispatch,
      destination: sanitizeDispatchDestination(dispatch.destination),
    };
  });

  app.addHook('onClose', async () => {
    await pipelineQueue?.close?.();
    await redisConnection?.quit();
    if (!options.prisma) await prisma.$disconnect();
  });

  return app;
};
