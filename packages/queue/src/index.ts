import {
  Queue,
  type JobSchedulerJson,
  type JobsOptions,
} from 'bullmq';
import IORedis from 'ioredis';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import type {
  PipelineScheduler,
  PipelineSchedulerState,
  SchedulerConfig,
} from './scheduler';

export type { JobsOptions };
export type {
  PipelineScheduler,
  PipelineSchedulerState,
  PipelineSchedulerStatus,
  SchedulerConfig,
} from './scheduler';

export const QUEUE_NAMES = {
  productPipeline: 'product-pipeline',
  whatsappDispatch: 'whatsapp-dispatch',
} as const;

export const JOB_NAMES = {
  pipelineProduct: 'pipeline-product',
  whatsappDispatch: 'whatsapp-dispatch',
} as const;

export const DEFAULT_PIPELINE_SCHEDULER_JOB_ID =
  'scheduled-pipeline-product';

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

export type BullMqPipelineSchedulerQueue = {
  upsertJobScheduler: (
    jobSchedulerId: string,
    repeatOptions: { pattern: string; tz: string },
    template: {
      name: typeof JOB_NAMES.pipelineProduct;
      data: PipelineProductJob;
    },
  ) => Promise<unknown>;
  getJobScheduler: (
    jobSchedulerId: string,
  ) => Promise<JobSchedulerJson<PipelineProductJob> | undefined>;
  removeJobScheduler: (jobSchedulerId: string) => Promise<boolean>;
};

const filtersAreEqual = (
  left?: ProductFilters,
  right?: ProductFilters,
) => {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value]) => right?.[key as keyof ProductFilters] === value,
    )
  );
};

const toSchedulerState = (
  jobId: string,
  scheduler?: JobSchedulerJson<PipelineProductJob>,
): PipelineSchedulerState => {
  if (!scheduler) {
    return {
      jobId,
      status: 'not-registered',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    };
  }

  return {
    jobId,
    status: 'registered',
    cronExpression: scheduler.pattern ?? null,
    timezone: scheduler.tz ?? null,
    filters: scheduler.template?.data?.filters,
    nextRunAt: scheduler.next
      ? new Date(scheduler.next).toISOString()
      : null,
  };
};

export class BullMqPipelineScheduler implements PipelineScheduler {
  constructor(private readonly queue: BullMqPipelineSchedulerQueue) {}

  async register(config: SchedulerConfig): Promise<PipelineSchedulerState> {
    if (!config.enabled) {
      return {
        jobId: config.jobId,
        status: 'disabled',
        cronExpression: config.cronExpression ?? null,
        timezone: config.timezone ?? null,
        filters: config.filters,
        nextRunAt: null,
      };
    }

    const existing = await this.queue.getJobScheduler(config.jobId);
    const alreadyRegistered =
      existing?.name === JOB_NAMES.pipelineProduct &&
      existing.pattern === config.cronExpression &&
      existing.tz === config.timezone &&
      filtersAreEqual(existing.template?.data?.filters, config.filters);

    if (!alreadyRegistered) {
      await this.queue.upsertJobScheduler(
        config.jobId,
        { pattern: config.cronExpression, tz: config.timezone },
        {
          name: JOB_NAMES.pipelineProduct,
          data: { filters: config.filters },
        },
      );
    }

    return this.getState(config.jobId);
  }

  async remove(jobId: string): Promise<PipelineSchedulerState> {
    await this.queue.removeJobScheduler(jobId);
    return this.getState(jobId);
  }

  async getState(jobId: string): Promise<PipelineSchedulerState> {
    return toSchedulerState(jobId, await this.queue.getJobScheduler(jobId));
  }
}

export const createBullMqPipelineScheduler = (
  queue: Queue<PipelineProductJob>,
) => new BullMqPipelineScheduler(queue);
