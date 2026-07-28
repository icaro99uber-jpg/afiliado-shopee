import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';

import {
  assertCommercialExecutionRecoveryEnvironment,
  assertCommercialExecutionRecoveryPaused,
  parseCommercialExecutionArgs,
  runCommercialExecutionCli,
  type CommercialExecutionCliRuntime,
} from '../src/commercial-execution-cli';

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

const runtime = (): CommercialExecutionCliRuntime => ({
  status: vi.fn(async () => ({ total: 0, items: [] })),
  recover: vi.fn(async (executionId: string) => ({
    outcome: 'recovered',
    execution: {
      id: executionId,
      status: 'failed',
      stale: false,
      heartbeatAt: null,
      leaseExpiresAt: null,
    },
  })),
  close: vi.fn(async () => undefined),
});

describe('commercial execution CLI', () => {
  it('aceita somente execution-id e confirmacao exatos', () => {
    expect(parseCommercialExecutionArgs(['status'])).toEqual({
      command: 'status',
    });
    expect(
      parseCommercialExecutionArgs([
        'recover',
        '--',
        '--execution-id=execution-1',
        '--confirm-stale-recovery',
      ]),
    ).toEqual({ command: 'recover', executionId: 'execution-1' });

    for (const args of [
      ['recover', '--run-id=run-1', '--confirm-stale-recovery'],
      ['recover', '--dispatch-id=dispatch-1', '--confirm-stale-recovery'],
      ['recover', '--job-id=job-1', '--confirm-stale-recovery'],
      ['recover', '--execution-id=execution-1'],
      ['status', '--execution-id=execution-1'],
      [
        'recover',
        '--execution-id=execution-1',
        '--confirm-stale-recovery',
        '--extra',
      ],
    ]) {
      expect(() => parseCommercialExecutionArgs(args)).toThrow();
    }
  });

  it.each([
    [
      'COMMERCIAL_AUTOMATION_MODE',
      'send',
      'COMMERCIAL_EXECUTION_PREVIEW_REQUIRED',
    ],
    [
      'COMMERCIAL_AUTOMATION_ENABLED',
      true,
      'COMMERCIAL_AUTOMATION_MUST_BE_DISABLED',
    ],
    [
      'COMMERCIAL_SCHEDULER_ENABLED',
      true,
      'COMMERCIAL_AUTOMATION_SCHEDULER_MUST_BE_DISABLED',
    ],
    ['SCHEDULER_ENABLED', true, 'LEGACY_SCHEDULER_MUST_BE_DISABLED'],
  ] as const)('bloqueia ambiente inseguro em %s', (field, value, code) => {
    expect(() =>
      assertCommercialExecutionRecoveryEnvironment({
        ...loadConfig(safeEnv),
        [field]: value,
      }),
    ).toThrowError(expect.objectContaining({ code }));
  });

  it('exige pausa persistida antes da recuperacao', () => {
    expect(() => assertCommercialExecutionRecoveryPaused(false)).toThrowError(
      expect.objectContaining({
        code: 'COMMERCIAL_AUTOMATION_PAUSED_REQUIRED',
      }),
    );
    expect(() => assertCommercialExecutionRecoveryPaused(undefined)).toThrow();
    expect(() => assertCommercialExecutionRecoveryPaused(true)).not.toThrow();
  });

  it('executa status sanitizado sem recovery', async () => {
    const subject = runtime();
    const logger = { info: vi.fn(), error: vi.fn() };
    const result = await runCommercialExecutionCli({
      args: ['status'],
      env: safeEnv,
      envPath: 'missing.env',
      logger,
      runtimeFactory: () => subject,
    });

    expect(result.exitCode).toBe(0);
    expect(subject.status).toHaveBeenCalledOnce();
    expect(subject.recover).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('ownerId');
  });

  it('recupera exatamente uma execucao e sempre fecha o runtime', async () => {
    const subject = runtime();
    const result = await runCommercialExecutionCli({
      args: [
        'recover',
        '--execution-id=execution-1',
        '--confirm-stale-recovery',
      ],
      env: safeEnv,
      envPath: 'missing.env',
      logger: { info: vi.fn(), error: vi.fn() },
      runtimeFactory: () => subject,
    });

    expect(result.exitCode).toBe(0);
    expect(subject.recover).toHaveBeenCalledOnce();
    expect(subject.recover).toHaveBeenCalledWith('execution-1');
    expect(subject.status).not.toHaveBeenCalled();
    expect(subject.close).toHaveBeenCalledOnce();
  });
});
