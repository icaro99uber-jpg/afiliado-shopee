import { readFileSync } from 'node:fs';

import { createWhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import { describe, expect, it, vi } from 'vitest';

import {
  EVOLUTION_REAL_SEND_FLAG,
  EVOLUTION_TEST_MESSAGE,
  runEvolutionSingleMessageTest,
} from '../src/evolution-single-message-test';

const SAFE_TEST_DESTINATION = '0000000000000';
const TEST_API_KEY = 'test-only-api-key';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test-only',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: TEST_API_KEY,
  EVOLUTION_INSTANCE_NAME: 'test-only-instance',
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_ALLOWED_DESTINATIONS: SAFE_TEST_DESTINATION,
  EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
  SCHEDULER_ENABLED: 'false',
} satisfies NodeJS.ProcessEnv;

const createLogger = () => ({
  info: vi.fn(),
  error: vi.fn(),
});

const createProvider = () => ({
  sendMessage: vi.fn(async () => ({
    externalMessageId: 'test-only-message-id',
    status: 'sent' as const,
    sentAt: new Date('2026-01-01T12:00:00.000Z'),
  })),
});

const execute = (
  options: {
    args?: readonly string[];
    env?: NodeJS.ProcessEnv;
    provider?: ReturnType<typeof createProvider>;
  } = {},
) => {
  const provider = options.provider ?? createProvider();
  const providerFactory = vi.fn(() => provider);
  const logger = createLogger();
  const result = runEvolutionSingleMessageTest({
    args: options.args ?? [],
    env: options.env ?? baseEnv,
    providerFactory,
    logger,
  });
  return { result, provider, providerFactory, logger };
};

describe('Evolution single message test command', () => {
  it('usa dry-run por padrao sem chamar HTTP ou sendMessage', async () => {
    const httpClient = vi.fn();
    const logger = createLogger();
    const providerFactory = vi.fn((config) =>
      createWhatsAppProvider(config, { httpClient }),
    );

    const result = await runEvolutionSingleMessageTest({
      args: [],
      env: baseEnv,
      logger,
      providerFactory,
    });

    expect(result).toEqual({
      exitCode: 0,
      output: {
        mode: 'dry-run',
        provider: 'evolution',
        safeMode: true,
        destination: '*********0000',
        maxMessagesPerBoot: 1,
        schedulerEnabled: false,
        messageWillBeSent: false,
      },
    });
    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('aceita somente a flag exata para entrar no caminho confirmado', async () => {
    const { result, provider } = execute({ args: [EVOLUTION_REAL_SEND_FLAG] });

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['--confirm-one-real-messag'],
    ['confirm-one-real-message'],
    ['--confirm-one-real-message=true'],
    [EVOLUTION_REAL_SEND_FLAG, EVOLUTION_REAL_SEND_FLAG],
    ['--destination', SAFE_TEST_DESTINATION],
  ])('rejeita argumentos ou confirmacao parecida: %s', async (...args) => {
    const { result, providerFactory } = execute({ args });

    await expect(result).resolves.toMatchObject({
      exitCode: 1,
      output: { code: 'EVOLUTION_TEST_FLAG_INVALID' },
    });
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it.each([
    ['CI ativo', { CI: 'true' }, 'EVOLUTION_TEST_CI_BLOCKED'],
    [
      'provider mock',
      { WHATSAPP_PROVIDER: 'mock' },
      'EVOLUTION_TEST_PROVIDER_REQUIRED',
    ],
    [
      'safe mode desativado',
      { EVOLUTION_SAFE_MODE: 'false' },
      'EVOLUTION_TEST_SAFE_MODE_REQUIRED',
    ],
    [
      'scheduler habilitado',
      {
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_CRON: '0 8 * * *',
        SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
      },
      'EVOLUTION_TEST_SCHEDULER_MUST_BE_DISABLED',
    ],
    [
      'allowlist vazia',
      { EVOLUTION_ALLOWED_DESTINATIONS: '' },
      'EVOLUTION_TEST_SINGLE_DESTINATION_REQUIRED',
    ],
    [
      'mais de um destino',
      {
        EVOLUTION_ALLOWED_DESTINATIONS: `${SAFE_TEST_DESTINATION},0000111111111`,
      },
      'EVOLUTION_TEST_SINGLE_DESTINATION_REQUIRED',
    ],
    [
      'limite diferente de um',
      { EVOLUTION_MAX_MESSAGES_PER_BOOT: '2' },
      'EVOLUTION_TEST_LIMIT_MUST_BE_ONE',
    ],
  ] as const)('bloqueia %s antes do provider', async (_name, env, code) => {
    const execution = execute({ env: { ...baseEnv, ...env } });

    await expect(execution.result).resolves.toMatchObject({
      exitCode: 1,
      output: { code },
    });
    expect(execution.providerFactory).not.toHaveBeenCalled();
    expect(execution.provider.sendMessage).not.toHaveBeenCalled();
  });

  it('bloqueia credencial ausente antes do provider sem expor configuracao', async () => {
    const logger = createLogger();
    const providerFactory = vi.fn();
    const result = await runEvolutionSingleMessageTest({
      args: [],
      env: { ...baseEnv, EVOLUTION_API_KEY: undefined },
      logger,
      providerFactory,
    });

    expect(result).toMatchObject({
      exitCode: 1,
      output: { code: 'EVOLUTION_TEST_CONFIG_INVALID' },
    });
    expect(providerFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(TEST_API_KEY);
  });

  it('aceita exatamente um destino e usa somente a allowlist', async () => {
    const { result, provider } = execute({ args: [EVOLUTION_REAL_SEND_FLAG] });

    await result;
    expect(provider.sendMessage).toHaveBeenCalledWith({
      destination: SAFE_TEST_DESTINATION,
      message: EVOLUTION_TEST_MESSAGE,
    });
  });

  it('usa exatamente a mensagem fixa sem produto, link ou copy', () => {
    expect(EVOLUTION_TEST_MESSAGE).toBe(
      'Teste controlado do sistema Afiliado Shopee. Nenhuma ação é necessária.',
    );
  });

  it('nao mostra destino completo, API key, URL ou mensagem nos logs', async () => {
    const { result, logger } = execute({ args: [EVOLUTION_REAL_SEND_FLAG] });
    await result;
    const logs = JSON.stringify([
      logger.info.mock.calls,
      logger.error.mock.calls,
    ]);

    expect(logs).not.toContain(SAFE_TEST_DESTINATION);
    expect(logs).not.toContain(TEST_API_KEY);
    expect(logs).not.toContain(baseEnv.EVOLUTION_API_URL);
    expect(logs).not.toContain(EVOLUTION_TEST_MESSAGE);
    expect(logs).toContain('*********0000');
  });

  it('retorna somente o resultado publico seguro no sucesso', async () => {
    const { result } = execute({ args: [EVOLUTION_REAL_SEND_FLAG] });

    await expect(result).resolves.toEqual({
      exitCode: 0,
      output: {
        status: 'sent',
        externalMessageId: 'test-only-message-id',
        sentAt: '2026-01-01T12:00:00.000Z',
        destination: '*********0000',
      },
    });
  });

  it('sanitiza falha desconhecida do provider e retorna exit code nao zero', async () => {
    const provider = createProvider();
    provider.sendMessage.mockRejectedValueOnce(
      new Error(`${TEST_API_KEY} ${SAFE_TEST_DESTINATION} external response`),
    );
    const { result, logger } = execute({
      args: [EVOLUTION_REAL_SEND_FLAG],
      provider,
    });

    await expect(result).resolves.toEqual({
      exitCode: 1,
      output: {
        code: 'EVOLUTION_TEST_SEND_FAILED',
        message: 'Falha segura no envio isolado da Evolution API',
        destination: '*********0000',
      },
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(TEST_API_KEY);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      SAFE_TEST_DESTINATION,
    );
  });

  it('mantem codigo interno seguro de falha do provider', async () => {
    const provider = createProvider();
    const providerError = Object.assign(
      new Error('Evolution API indisponivel'),
      { code: 'EVOLUTION_SERVER_ERROR' },
    );
    provider.sendMessage.mockRejectedValueOnce(
      providerError,
    );
    const { result } = execute({
      args: [EVOLUTION_REAL_SEND_FLAG],
      provider,
    });

    await expect(result).resolves.toMatchObject({
      exitCode: 1,
      output: {
        code: 'EVOLUTION_SERVER_ERROR',
        message: 'Falha segura no envio isolado da Evolution API',
        destination: '*********0000',
      },
    });
  });

  it('permanece isolado de banco, Redis, BullMQ, Scheduler e PipelineService', () => {
    const source = readFileSync(
      new URL('../src/evolution-single-message-test.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/database|createPrisma|bullmq|packages\/queue/i);
    expect(source).not.toMatch(/WhatsAppDispatch|PipelineService|startWorker/);
    expect(source).not.toMatch(/scheduler\.register|createBullMq/);
  });
});
