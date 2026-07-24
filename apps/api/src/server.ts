import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { EvolutionApiGroupDirectoryProvider } from '@shopee-auto-affiliate-ai/providers';
import { buildApp } from './app';

const start = async () => {
  const config = loadConfig();
  const groupDirectoryProvider =
    config.WHATSAPP_PROVIDER === 'evolution'
      ? new EvolutionApiGroupDirectoryProvider({
          baseUrl: config.EVOLUTION_API_URL as string,
          apiKey: config.EVOLUTION_API_KEY as string,
          instanceName: config.EVOLUTION_INSTANCE_NAME as string,
        })
      : undefined;
  const app = await buildApp({
    redisUrl: config.REDIS_URL,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    groupDirectoryProvider,
    groupInstanceName: config.EVOLUTION_INSTANCE_NAME,
  });
  await app.listen({ host: '0.0.0.0', port: config.PORT });
};
void start();
