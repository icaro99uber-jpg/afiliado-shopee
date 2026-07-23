import { Worker } from 'bullmq';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createRedisConnection, JOB_NAMES, QUEUE_NAMES, type PipelineProductJob } from '@shopee-auto-affiliate-ai/queue';

export const createPipelineProductWorker = (redisUrl: string) => {
  const connection = createRedisConnection(redisUrl);
  return new Worker<PipelineProductJob>(QUEUE_NAMES.productPipeline, async (job) => {
    if (job.name !== JOB_NAMES.pipelineProduct) return { skipped: true };
    return { processed: true, query: job.data.query };
  }, { connection });
};

if (process.env.NODE_ENV !== 'test') {
  const config = loadConfig();
  createPipelineProductWorker(config.REDIS_URL);
}
