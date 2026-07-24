import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  MockShopeeProvider,
  MockWhatsAppProvider,
  type HunterProvider,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  JOB_NAMES,
  QUEUE_NAMES,
  type PipelineProductJob,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createApplicationServices,
  createPrismaRepositories,
} from '../../api/src/application-services';

type WorkerLogger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type CreatePipelineProductWorkerOptions = {
  prisma?: ReturnType<typeof createPrismaClient>;
  hunterProvider?: HunterProvider;
  logger?: WorkerLogger;
  whatsAppProvider?: WhatsAppProvider;
};

const consoleLogger: WorkerLogger = {
  info: (obj, msg) => console.info(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export const processPipelineProductJob = async (
  job: Pick<Job<PipelineProductJob>, 'id' | 'name' | 'data' | 'updateProgress'>,
  options: Required<CreatePipelineProductWorkerOptions>,
) => {
  if (job.name !== JOB_NAMES.pipelineProduct) return { skipped: true };

  options.logger.info(
    { event: 'pipeline.job.received', jobId: job.id, data: job.data },
    'Job recebido',
  );
  await job.updateProgress(10);
  options.logger.info(
    { event: 'pipeline.job.started', jobId: job.id },
    'Pipeline iniciado',
  );

  try {
    const repositories = createPrismaRepositories(options.prisma);
    const services = createApplicationServices({
      repositories,
      hunterProvider: options.hunterProvider,
      whatsAppProvider: options.whatsAppProvider,
      logger: options.logger,
    });
    const result = await services.pipeline.run(job.data.filters);
    await job.updateProgress(100);
    options.logger.info(
      { event: 'pipeline.job.completed', jobId: job.id, result },
      'Pipeline concluído',
    );
    return result;
  } catch (error) {
    options.logger.error(
      { event: 'pipeline.job.failed', jobId: job.id, error },
      'Pipeline falhou',
    );
    throw error;
  }
};

export const processWhatsAppDispatchJob = async (
  job: Pick<Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'>,
  options: Required<CreatePipelineProductWorkerOptions>,
) => {
  if (job.name !== JOB_NAMES.whatsappDispatch) return { skipped: true };
  const repositories = createPrismaRepositories(options.prisma);
  const services = createApplicationServices({
    repositories,
    hunterProvider: options.hunterProvider,
    whatsAppProvider: options.whatsAppProvider,
    logger: options.logger,
  });
  return services.sender?.sendDispatch(job.data.dispatchId);
};

export const createPipelineProductWorker = (
  redisUrl: string,
  options: CreatePipelineProductWorkerOptions = {},
) => {
  const connection = createRedisConnection(redisUrl);
  const prisma = options.prisma ?? createPrismaClient();
  const workerOptions = {
    prisma,
    hunterProvider: options.hunterProvider ?? new MockShopeeProvider(),
    logger: options.logger ?? consoleLogger,
    whatsAppProvider: options.whatsAppProvider ?? new MockWhatsAppProvider(),
  };

  const worker = new Worker<PipelineProductJob>(
    QUEUE_NAMES.productPipeline,
    async (job) => processPipelineProductJob(job, workerOptions),
    { connection },
  );

  const whatsappWorker = new Worker<WhatsAppDispatchJob>(
    QUEUE_NAMES.whatsappDispatch,
    async (job) => processWhatsAppDispatchJob(job, workerOptions),
    { connection },
  );

  whatsappWorker.on('closed', async () => undefined);

  worker.on('closed', async () => {
    await connection.quit();
    if (!options.prisma) await prisma.$disconnect();
  });

  return {
    productPipelineWorker: worker,
    whatsappDispatchWorker: whatsappWorker,
  };
};

if (process.env.NODE_ENV !== 'test') {
  const config = loadConfig();
  createPipelineProductWorker(config.REDIS_URL);
}
