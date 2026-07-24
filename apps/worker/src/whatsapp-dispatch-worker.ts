import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import type {
  HunterProvider,
  WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  JOB_NAMES,
  QUEUE_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createPrismaRepositories,
  createSenderService,
} from '../../api/src/application-services';

export type WhatsAppDispatchWorkerLogger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type WhatsAppDispatchProcessorOptions = {
  prisma: ReturnType<typeof createPrismaClient>;
  logger: WhatsAppDispatchWorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  messageBuilder?: (copy: {
    titulo: string;
    mensagem: string;
    cta: string;
    hashtags: string;
  }) => string;
  // Mantido apenas para compatibilidade com os callers existentes. O consumer
  // isolado nao instancia nem usa Hunter, Score, Copy ou Pipeline.
  hunterProvider?: HunterProvider;
};

type CreateWhatsAppDispatchWorkerOptions = {
  connection?: ReturnType<typeof createRedisConnection>;
  prisma?: ReturnType<typeof createPrismaClient>;
  logger?: WhatsAppDispatchWorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  messageBuilder?: WhatsAppDispatchProcessorOptions['messageBuilder'];
};

const consoleLogger: WhatsAppDispatchWorkerLogger = {
  info: (obj, msg) => console.info(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export const processWhatsAppDispatchJob = async (
  job: Pick<Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'>,
  options: WhatsAppDispatchProcessorOptions,
) => {
  if (job.name !== JOB_NAMES.whatsappDispatch) return { skipped: true };

  const repositories = createPrismaRepositories(options.prisma);
  const sender = createSenderService({
    repositories,
    whatsAppProvider: options.whatsAppProvider,
    logger: options.logger,
    messageBuilder: options.messageBuilder,
  });
  return sender.sendDispatch(job.data.dispatchId);
};

export const createWhatsAppDispatchWorker = (
  redisUrl: string,
  options: CreateWhatsAppDispatchWorkerOptions,
) => {
  const ownsConnection = !options.connection;
  const ownsPrisma = !options.prisma;
  const connection = options.connection ?? createRedisConnection(redisUrl);
  const prisma = options.prisma ?? createPrismaClient();
  const processorOptions: WhatsAppDispatchProcessorOptions = {
    prisma,
    logger: options.logger ?? consoleLogger,
    whatsAppProvider: options.whatsAppProvider,
    messageBuilder: options.messageBuilder,
  };
  const worker = new Worker<WhatsAppDispatchJob>(
    QUEUE_NAMES.whatsappDispatch,
    async (job) => processWhatsAppDispatchJob(job, processorOptions),
    { connection },
  );
  let closePromise: Promise<void> | undefined;

  return {
    whatsappDispatchWorker: worker,
    close: (force = false) => {
      closePromise ??= (async () => {
        let firstError: unknown;
        for (const cleanup of [
          () => worker.close(force),
          ...(ownsPrisma ? [() => prisma.$disconnect()] : []),
          ...(ownsConnection
            ? [() => connection.quit().then(() => undefined)]
            : []),
        ]) {
          try {
            await cleanup();
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError) throw firstError;
      })();
      return closePromise;
    },
  };
};
