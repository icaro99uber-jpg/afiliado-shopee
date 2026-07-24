import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EvolutionApiWhatsAppProvider,
  type HttpClient,
  type ProviderLogger,
} from './evolution-api-whatsapp-provider';
import { MockWhatsAppProvider } from './index';
import { createWhatsAppProvider } from './whatsapp-provider-factory';

const API_KEY = 'test-api-key-never-log';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const createLogger = (): ProviderLogger => ({
  info: vi.fn(),
  error: vi.fn(),
});

const createProvider = (
  httpClient: HttpClient = vi
    .fn()
    .mockResolvedValue(response({ key: { id: 'message-123' } })),
  overrides: Partial<
    ConstructorParameters<typeof EvolutionApiWhatsAppProvider>[0]
  > = {},
) =>
  new EvolutionApiWhatsAppProvider({
    baseUrl: 'http://localhost:8080/',
    apiKey: API_KEY,
    instanceName: 'affiliate bot',
    httpClient,
    ...overrides,
  });

describe('EvolutionApiWhatsAppProvider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('envia texto e mapeia o resultado sem expor a resposta externa', async () => {
    const provider = createProvider();

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).resolves.toEqual({
      externalMessageId: 'message-123',
      status: 'sent',
      sentAt: expect.any(Date),
    });
  });

  it('monta URL, headers e payload do contrato Evolution API v2', async () => {
    const httpClient = vi
      .fn()
      .mockResolvedValue(response({ key: { id: 'message-123' } }));
    const provider = createProvider(httpClient);

    await provider.sendMessage({
      destination: '5511999999999',
      message: 'Oferta do dia',
    });

    expect(httpClient).toHaveBeenCalledWith(
      'http://localhost:8080/message/sendText/affiliate%20bot',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: API_KEY,
        },
        body: JSON.stringify({
          number: '5511999999999',
          textMessage: { text: 'Oferta do dia' },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    [
      'destination',
      { destination: ' ', message: 'Oferta' },
      'WHATSAPP_DESTINATION_REQUIRED',
    ],
    [
      'message',
      { destination: '5511999999999', message: ' ' },
      'WHATSAPP_MESSAGE_REQUIRED',
    ],
  ] as const)('rejeita %s vazio', async (_field, input, code) => {
    const provider = createProvider();
    await expect(provider.sendMessage(input)).rejects.toMatchObject({ code });
  });

  it('rejeita URL invalida', () => {
    expect(() =>
      createProvider(undefined, { baseUrl: 'not-a-url' }),
    ).toThrowError(expect.objectContaining({ code: 'EVOLUTION_INVALID_URL' }));
  });

  it.each([
    ['apiKey', { apiKey: ' ' }, 'EVOLUTION_API_KEY_REQUIRED'],
    ['instanceName', { instanceName: ' ' }, 'EVOLUTION_INSTANCE_NAME_REQUIRED'],
  ] as const)('rejeita %s vazio', (_field, overrides, code) => {
    expect(() => createProvider(undefined, overrides)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    [400, 'EVOLUTION_BAD_REQUEST'],
    [401, 'EVOLUTION_UNAUTHORIZED'],
    [403, 'EVOLUTION_FORBIDDEN'],
    [404, 'EVOLUTION_NOT_FOUND'],
    [429, 'EVOLUTION_RATE_LIMITED'],
    [500, 'EVOLUTION_SERVER_ERROR'],
    [503, 'EVOLUTION_SERVER_ERROR'],
  ])('mapeia HTTP %i para %s', async (status, code) => {
    const provider = createProvider(
      vi.fn().mockResolvedValue(response({ error: 'external error' }, status)),
    );

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({ code });
  });

  it('mapeia timeout sem realizar retry', async () => {
    const httpClient: HttpClient = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const provider = createProvider(httpClient, { timeoutMs: 5 });

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({ code: 'EVOLUTION_TIMEOUT' });
  });

  it('mapeia erro de rede', async () => {
    const provider = createProvider(
      vi.fn().mockRejectedValue(new TypeError('network unavailable')),
    );

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({ code: 'EVOLUTION_NETWORK_ERROR' });
  });

  it('rejeita resposta sem identificador de mensagem', async () => {
    const provider = createProvider(vi.fn().mockResolvedValue(response({})));

    await expect(
      provider.sendMessage({ destination: '5511999999999', message: 'Oferta' }),
    ).rejects.toMatchObject({ code: 'EVOLUTION_MESSAGE_ID_MISSING' });
  });

  it('nao inclui a API key em erros ou logs', async () => {
    const logger = createLogger();
    const provider = createProvider(
      vi.fn().mockResolvedValue(response({ error: API_KEY }, 401)),
      { logger },
    );

    let caught: unknown;
    try {
      await provider.sendMessage({
        destination: '5511999999999',
        message: 'Oferta',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(String(caught)).not.toContain(API_KEY);
    expect(JSON.stringify(caught)).not.toContain(API_KEY);
    expect(
      JSON.stringify([
        vi.mocked(logger.info).mock.calls,
        vi.mocked(logger.error).mock.calls,
      ]),
    ).not.toContain(API_KEY);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: 'affiliate bot',
        destination: expect.not.stringContaining('5511999999999'),
        code: 'EVOLUTION_UNAUTHORIZED',
        status: 401,
      }),
      'Evolution API message failed',
    );
  });
});

describe('createWhatsAppProvider', () => {
  it('usa mock como padrao sem exigir configuracao da Evolution API', () => {
    expect(createWhatsAppProvider({})).toBeInstanceOf(MockWhatsAppProvider);
  });

  it('usa mock quando selecionado explicitamente', () => {
    expect(
      createWhatsAppProvider({ WHATSAPP_PROVIDER: 'mock' }),
    ).toBeInstanceOf(MockWhatsAppProvider);
  });

  it('cria o provider Evolution somente quando selecionado', () => {
    expect(
      createWhatsAppProvider({
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: API_KEY,
        EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      }),
    ).toBeInstanceOf(EvolutionApiWhatsAppProvider);
  });

  it.each([
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
  ] as const)('exige %s no modo evolution', (field) => {
    const config = {
      WHATSAPP_PROVIDER: 'evolution' as const,
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: API_KEY,
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      [field]: '',
    };

    expect(() => createWhatsAppProvider(config)).toThrowError(
      expect.objectContaining({ code: 'EVOLUTION_CONFIG_REQUIRED' }),
    );
  });
});
