import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';

import { startIsolatedWhatsAppDispatchWorker } from '../src/whatsapp-dispatch-runtime';
import { createWhatsAppDispatchWorker } from '../src/whatsapp-dispatch-worker';

const previewConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: 'preview',
});

const sendConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: 'send',
  SHOPEE_AFFILIATE_PROVIDER: 'official',
  SHOPEE_AFFILIATE_API_ENABLED: 'true',
  SHOPEE_AFFILIATE_API_URL: 'https://example.test',
  SHOPEE_AFFILIATE_APP_ID: 'test-app',
  SHOPEE_AFFILIATE_SECRET: 'test-secret',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'test-key',
  EVOLUTION_INSTANCE_NAME: 'test-instance',
  WHATSAPP_GROUP_SEND_ENABLED: 'true',
});

describe('isolated WhatsApp dispatch worker', () => {
  it('fails closed in preview before creating provider or worker', () => {
    const providerFactory = vi.fn();
    const workerFactory = vi.fn();
    expect(() =>
      startIsolatedWhatsAppDispatchWorker(previewConfig, {
        providerFactory,
        workerFactory,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'WHATSAPP_DISPATCH_WORKER_SEND_MODE_REQUIRED',
      }),
    );
    expect(providerFactory).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('compoe somente provider, politica e consumer de whatsapp-dispatch', async () => {
    const provider: WhatsAppProvider = {
      sendMessage: vi.fn<WhatsAppProvider['sendMessage']>(async () => ({
        externalMessageId: 'mock-id',
        status: 'sent' as const,
        sentAt: new Date('2026-07-25T12:00:00.000Z'),
      })),
    };
    const close = vi.fn(async () => undefined);
    const providerFactory = vi.fn<typeof createWhatsAppProvider>(
      (_config, _options) => provider,
    );
    const workerFactory = vi.fn(
      (
        _redisUrl: string,
        _options: Parameters<typeof createWhatsAppDispatchWorker>[1],
      ) =>
        ({
          whatsappDispatchWorker: { name: 'whatsapp-dispatch' },
          close,
        }) as unknown as ReturnType<typeof createWhatsAppDispatchWorker>,
    );
    const logger = { info: vi.fn(), error: vi.fn() };

    const runtime = startIsolatedWhatsAppDispatchWorker(sendConfig, {
      providerFactory,
      workerFactory,
      logger,
    });

    expect(providerFactory).toHaveBeenCalledOnce();
    expect(workerFactory).toHaveBeenCalledOnce();
    expect(workerFactory.mock.calls[0][0]).toBe(sendConfig.REDIS_URL);
    expect(workerFactory.mock.calls[0][1]).toMatchObject({
      logger,
      whatsAppProvider: provider,
      groupSendPolicy: expect.any(Object),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp-dispatch.worker.started',
        queue: 'whatsapp-dispatch',
      }),
      expect.any(String),
    );
    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
