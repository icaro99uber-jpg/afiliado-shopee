import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  EvolutionApiWhatsAppProvider,
  MockShopeeProvider,
  MockWhatsAppProvider,
  type HttpClient,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { JOB_NAMES } from '@shopee-auto-affiliate-ai/queue';

import { processWhatsAppDispatchJob, startWorker } from '../src/index';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

const logger = { info: vi.fn(), error: vi.fn() };

const createDispatch = (status = 'PENDING') => ({
  id: 'dispatch-1',
  productId: 'product-1',
  generatedCopyId: 'copy-1',
  destinationId: 'destination-1',
  status,
  attemptCount: 0,
  generatedCopy: {
    titulo: 'Oferta',
    mensagem: 'Mensagem promocional',
    cta: 'Compre agora',
    hashtags: '#Oferta',
  },
  destination: { destination: 'mock-destination-01' },
});

const createPrismaMock = (initialStatus = 'PENDING') => {
  let dispatch = createDispatch(initialStatus);
  return {
    $disconnect: vi.fn(),
    productLead: {},
    generatedCopy: {},
    whatsAppDestination: {},
    whatsAppDispatch: {
      findUnique: vi.fn(async () => dispatch),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        dispatch = { ...dispatch, ...data } as typeof dispatch;
        return dispatch;
      }),
    },
  };
};

const createJob = () => ({
  id: 'job-dispatch-1',
  name: JOB_NAMES.whatsappDispatch,
  data: { dispatchId: 'dispatch-1' },
});

const processDispatch = (
  prisma: ReturnType<typeof createPrismaMock>,
  whatsAppProvider: WhatsAppProvider,
) =>
  processWhatsAppDispatchJob(createJob(), {
    prisma: prisma as never,
    hunterProvider: new MockShopeeProvider(),
    logger,
    whatsAppProvider,
  });

const bootstrapProvider = (
  config: AppEnv,
  providerFactoryOptions: { httpClient?: HttpClient } = {},
) => {
  let provider: WhatsAppProvider | undefined;
  const workerFactory = vi.fn((_redisUrl, options) => {
    provider = options.whatsAppProvider;
    return {} as never;
  });

  startWorker(config, {
    logger,
    providerFactoryOptions,
    workerFactory,
  });

  return { provider: provider as WhatsAppProvider, workerFactory };
};

describe('WhatsApp provider worker bootstrap', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('inicia em mock por padrao e registra a fila sem chamar HTTP', () => {
    const httpClient = vi.fn();
    const config = loadConfig(baseEnv);
    const { provider, workerFactory } = bootstrapProvider(config, {
      httpClient,
    });

    expect(provider).toBeInstanceOf(MockWhatsAppProvider);
    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(httpClient).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'worker.whatsapp-provider.selected',
        provider: 'mock',
        queue: 'whatsapp-dispatch',
      },
      'WhatsApp provider selected',
    );
  });

  it('seleciona mock somente por WHATSAPP_PROVIDER mesmo com dados Evolution', () => {
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'mock',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });

    expect(bootstrapProvider(config).provider).toBeInstanceOf(
      MockWhatsAppProvider,
    );
  });

  it('registra configuracao Evolution sem API key ou credenciais da URL', () => {
    const apiKey = 'test-only-api-key';
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://test-user:test-password@localhost:8080',
      EVOLUTION_API_KEY: apiKey,
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });

    bootstrapProvider(config, { httpClient: vi.fn() });

    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'worker.whatsapp-provider.selected',
        provider: 'evolution',
        queue: 'whatsapp-dispatch',
        instanceName: 'affiliate-bot',
        baseUrl: 'http://localhost:8080',
      },
      'WhatsApp provider selected',
    );
    const logs = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logs).not.toContain(apiKey);
    expect(logs).not.toContain('test-user');
    expect(logs).not.toContain('test-password');
  });

  it('falha antes de criar workers quando a configuracao Evolution esta incompleta', () => {
    const workerFactory = vi.fn();
    const secret = 'test-only-api-key';
    let caught: unknown;

    try {
      const config = loadConfig({
        ...baseEnv,
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_KEY: secret,
      });
      startWorker(config, { workerFactory: workerFactory as never });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).not.toContain(secret);
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('cria o provider uma vez no bootstrap e nao por job', async () => {
    const providerFactory = vi.fn(createWhatsAppProvider);
    const config = loadConfig(baseEnv);
    let provider: WhatsAppProvider | undefined;

    startWorker(config, {
      logger,
      providerFactory,
      workerFactory: (_redisUrl, options) => {
        provider = options.whatsAppProvider;
        return {} as never;
      },
    });

    await processDispatch(createPrismaMock(), provider as WhatsAppProvider);
    await processDispatch(createPrismaMock(), provider as WhatsAppProvider);

    expect(providerFactory).toHaveBeenCalledTimes(1);
  });
});

describe('whatsapp-dispatch worker provider integration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('processa dispatch em modo mock sem chamar fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { provider } = bootstrapProvider(loadConfig(baseEnv));

    await expect(
      processDispatch(createPrismaMock(), provider),
    ).resolves.toMatchObject({
      status: 'SENT',
      externalMessageId: 'mock-whatsapp-1',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('usa Evolution injetado com HTTP mockado', async () => {
    const httpClient = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: { id: 'evolution-message-1' } }), {
        status: 200,
      }),
    );
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });
    const { provider } = bootstrapProvider(config, { httpClient });

    expect(provider).toBeInstanceOf(EvolutionApiWhatsAppProvider);
    await expect(
      processDispatch(createPrismaMock(), provider),
    ).resolves.toMatchObject({
      status: 'SENT',
      externalMessageId: 'evolution-message-1',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('relanca erro Evolution para permitir retry do BullMQ', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 }),
      );
    const config = loadConfig({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-only-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
    });
    const { provider } = bootstrapProvider(config, { httpClient });

    await expect(
      processDispatch(createPrismaMock(), provider),
    ).rejects.toMatchObject({ code: 'EVOLUTION_SERVER_ERROR' });
  });

  it('permite tentar novamente um dispatch FAILED', async () => {
    const provider = new MockWhatsAppProvider();
    const prisma = createPrismaMock('FAILED');

    await expect(processDispatch(prisma, provider)).resolves.toMatchObject({
      status: 'SENT',
    });
    expect(provider.sentMessages).toHaveLength(1);
  });

  it('nao reenvia dispatch SENT', async () => {
    const provider = new MockWhatsAppProvider();
    const prisma = createPrismaMock('SENT');

    await expect(processDispatch(prisma, provider)).resolves.toMatchObject({
      status: 'SENT',
    });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalled();
  });
});
