import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';

import {
  assertCommercialOutboxEnvironment,
  parseCommercialOutboxArgs,
  runCommercialOutboxCli,
  type CommercialOutboxCliRuntime,
} from '../src/commercial-outbox-cli';

const safeEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: 'preview',
  COMMERCIAL_SCHEDULER_ENABLED: 'false',
  COMMERCIAL_AUTOMATION_ENABLED: 'false',
  SCHEDULER_ENABLED: 'false',
  WHATSAPP_GROUP_SEND_ENABLED: 'false',
};

const runtime = (): CommercialOutboxCliRuntime => ({
  status: vi.fn(async () => ({ total: 0, items: [] })),
  reconcile: vi.fn(async (outboxId: string) => ({
    id: outboxId,
    status: 'published',
  })),
  close: vi.fn(async () => undefined),
});

describe('commercial outbox CLI', () => {
  it('aceita somente os comandos e a confirmacao exatos', () => {
    expect(parseCommercialOutboxArgs(['status'])).toEqual({
      command: 'status',
    });
    expect(
      parseCommercialOutboxArgs([
        'reconcile',
        '--',
        '--outbox-id=outbox-id',
        '--confirm-safe-publication',
      ]),
    ).toEqual({ command: 'reconcile', outboxId: 'outbox-id' });
    for (const args of [
      ['reconcile', '--run-id=run-id', '--confirm-safe-publication'],
      ['reconcile', '--dispatch-id=dispatch-id', '--confirm-safe-publication'],
      ['reconcile', '--job-id=job-id', '--confirm-safe-publication'],
      ['reconcile', '--outbox-id=outbox-id'],
      ['status', '--outbox-id=outbox-id'],
    ]) {
      expect(() => parseCommercialOutboxArgs(args)).toThrow();
    }
  });

  it.each([
    [
      'COMMERCIAL_AUTOMATION_MODE',
      'send',
      'COMMERCIAL_OUTBOX_PREVIEW_REQUIRED',
    ],
    [
      'COMMERCIAL_SCHEDULER_ENABLED',
      true,
      'COMMERCIAL_AUTOMATION_SCHEDULER_MUST_BE_DISABLED',
    ],
    ['SCHEDULER_ENABLED', true, 'LEGACY_SCHEDULER_MUST_BE_DISABLED'],
  ] as const)('bloqueia ambiente inseguro em %s', (field, value, code) => {
    const config = { ...loadConfig(safeEnv), [field]: value };
    expect(() => assertCommercialOutboxEnvironment(config)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('executa status sem fila, worker ou provider', async () => {
    const subject = runtime();
    const logger = { info: vi.fn(), error: vi.fn() };
    const result = await runCommercialOutboxCli({
      args: ['status'],
      env: safeEnv,
      envPath: 'missing.env',
      logger,
      runtimeFactory: () => subject,
    });
    expect(result.exitCode).toBe(0);
    expect(subject.status).toHaveBeenCalledOnce();
    expect(subject.reconcile).not.toHaveBeenCalled();
    expect(subject.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(
      /destination|jid|phone|apiKey|payload/iu,
    );
  });

  it('reconcilia exatamente um outbox e fecha sem iniciar worker', async () => {
    const subject = runtime();
    const result = await runCommercialOutboxCli({
      args: [
        'reconcile',
        '--outbox-id=outbox-id',
        '--confirm-safe-publication',
      ],
      env: safeEnv,
      envPath: 'missing.env',
      logger: { info: vi.fn(), error: vi.fn() },
      runtimeFactory: () => subject,
    });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(subject.reconcile).toHaveBeenCalledOnce();
    expect(subject.reconcile).toHaveBeenCalledWith('outbox-id');
    expect(subject.status).not.toHaveBeenCalled();
  });
});
