import Fastify from 'fastify';
import cors from '@fastify/cors';

type BuildAppOptions = { logger?: boolean };
export const buildApp = async (options: BuildAppOptions = {}) => {
  const app = Fastify({ logger: options.logger ?? true });
  await app.register(cors, { origin: true });
  app.get('/health', async () => ({ status: 'ok', service: 'api' }));
  return app;
};
