import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { buildApp } from './app';

const start = async () => {
  const config = loadConfig();
  const app = await buildApp({
    redisUrl: config.REDIS_URL,
    schedulerEnabled: config.SCHEDULER_ENABLED,
  });
  await app.listen({ host: '0.0.0.0', port: config.PORT });
};
void start();
