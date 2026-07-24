import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';

export type { JobsOptions };

export const QUEUE_NAMES = {
  productPipeline: 'product-pipeline',
  whatsappDispatch: 'whatsapp-dispatch',
} as const;

export const JOB_NAMES = {
  pipelineProduct: 'pipeline-product',
  whatsappDispatch: 'whatsapp-dispatch',
} as const;

export const DEFAULT_WHATSAPP_DISPATCH_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 1_000 },
};

export const createRedisConnection = (url: string) =>
  new IORedis(url, { maxRetriesPerRequest: null });

export const createProductPipelineQueue = (connection: IORedis) =>
  new Queue<PipelineProductJob>(QUEUE_NAMES.productPipeline, { connection });

export const createWhatsAppDispatchQueue = (connection: IORedis) =>
  new Queue<WhatsAppDispatchJob>(QUEUE_NAMES.whatsappDispatch, { connection });

export type PipelineProductJob = { filters?: ProductFilters };
export type WhatsAppDispatchJob = { dispatchId: string };

export const enqueuePipelineProduct = (
  queue: Queue<PipelineProductJob>,
  data: PipelineProductJob,
  opts?: JobsOptions,
) => queue.add(JOB_NAMES.pipelineProduct, data, opts);

export const enqueueWhatsAppDispatch = (
  queue: Queue<WhatsAppDispatchJob>,
  data: WhatsAppDispatchJob,
  opts?: JobsOptions,
) =>
  queue.add(JOB_NAMES.whatsappDispatch, data, {
    ...DEFAULT_WHATSAPP_DISPATCH_JOB_OPTIONS,
    ...opts,
  });
