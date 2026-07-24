import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';

export const QUEUE_NAMES = { productPipeline: 'product-pipeline' } as const;
export const JOB_NAMES = { pipelineProduct: 'pipeline-product' } as const;
export const createRedisConnection = (url: string) =>
  new IORedis(url, { maxRetriesPerRequest: null });
export const createProductPipelineQueue = (connection: IORedis) =>
  new Queue<PipelineProductJob>(QUEUE_NAMES.productPipeline, { connection });
export type PipelineProductJob = { filters?: ProductFilters };
export const enqueuePipelineProduct = (
  queue: Queue<PipelineProductJob>,
  data: PipelineProductJob,
  opts?: JobsOptions,
) => queue.add(JOB_NAMES.pipelineProduct, data, opts);
