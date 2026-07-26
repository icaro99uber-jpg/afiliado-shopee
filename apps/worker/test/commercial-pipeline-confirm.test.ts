import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS } from '@shopee-auto-affiliate-ai/queue';

import {
  COMMERCIAL_CONFIRM_REAL_FLAG,
  assertCommercialConfirmEnvironment,
  executeCommercialConfirm,
  parseCommercialConfirmArgs,
  runCommercialConfirm,
  type CommercialConfirmRuntime,
} from '../src/commercial-pipeline-confirm';

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://local:local@localhost:5432/local',
  REDIS_URL: 'redis://localhost:6379',
  SHOPEE_AFFILIATE_PROVIDER: 'mock',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: 'local-test-key',
  EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
  WHATSAPP_GROUP_SEND_ENABLED: 'true',
  WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
  SCHEDULER_ENABLED: 'false',
};

const publicRun = (overrides: Record<string, unknown> = {}) => ({
  id: 'run-id',
  mode: 'confirmed',
  status: 'completed',
  selectedProduct: { id: 'product', name: 'Produto ficticio', price: '29.90' },
  selectedGroup: {
    id: 'group',
    name: 'Grupo ficticio',
    fingerprint: 'grp_123456789abc',
  },
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: [],
  copyPreview: 'Copy ficticia',
  plannedSubIds: [],
  failureCode: null,
  confirmedAt: '2026-07-25T23:00:00.000Z',
  finalStatus: 'sent',
  dispatchStatus: 'sent',
  attemptCount: 1,
  externalMessageIdRecorded: true,
  investigationRequired: false,
  createdAt: '2026-07-25T22:00:00.000Z',
  completedAt: '2026-07-25T23:00:01.000Z',
  dispatchWasCreated: true,
  jobWasCreated: true,
  messageWasSent: true,
  confirmationAvailable: false,
  ...overrides,
});

const runtime = (run = publicRun()) => {
  const value = {
    assertNoCompetingWork: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(undefined),
    startWorker: vi.fn().mockResolvedValue(undefined),
    waitForJob: vi.fn().mockResolvedValue(undefined),
    readRun: vi.fn().mockResolvedValue(run),
    markInvestigationRequired: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return value as unknown as CommercialConfirmRuntime & typeof value;
};

describe('commercial pipeline confirm CLI', () => {
  it('aceita somente run-id unico e flag real exata', () => {
    expect(
      parseCommercialConfirmArgs([
        '--run-id=run-id',
        COMMERCIAL_CONFIRM_REAL_FLAG,
      ]),
    ).toEqual({ runId: 'run-id' });
    expect(
      parseCommercialConfirmArgs([
        '--',
        '--run-id=run-id',
        COMMERCIAL_CONFIRM_REAL_FLAG,
      ]),
    ).toEqual({ runId: 'run-id' });
  });

  it.each([
    { args: [] },
    { args: ['--run-id=one'] },
    { args: ['--run-id=one', '--run-id=two', COMMERCIAL_CONFIRM_REAL_FLAG] },
    { args: ['--run-id=one', '--confirm-one-real-commercial-messages'] },
    {
      args: [
        '--run-id=one',
        COMMERCIAL_CONFIRM_REAL_FLAG,
        '--message=forbidden',
      ],
    },
    {
      args: ['--run-id=one', COMMERCIAL_CONFIRM_REAL_FLAG, '--group=forbidden'],
    },
    {
      args: [
        '--run-id=one',
        COMMERCIAL_CONFIRM_REAL_FLAG,
        '--product=forbidden',
      ],
    },
    {
      args: ['--run-id=one', COMMERCIAL_CONFIRM_REAL_FLAG, '--link=forbidden'],
    },
    {
      args: [
        '--run-id=one',
        COMMERCIAL_CONFIRM_REAL_FLAG,
        '--coupon=forbidden',
      ],
    },
  ])('rejeita flags parecidas ou dados comerciais', ({ args }) => {
    expect(() => parseCommercialConfirmArgs(args)).toThrow();
  });

  it.each([
    [{ CI: 'true' }, 'COMMERCIAL_CONFIRM_CI_BLOCKED'],
    [
      {
        SHOPEE_AFFILIATE_PROVIDER: 'official',
        SHOPEE_AFFILIATE_API_ENABLED: 'true',
        SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/api',
        SHOPEE_AFFILIATE_APP_ID: 'test-app',
        SHOPEE_AFFILIATE_SECRET: 'test-secret',
      },
      'SHOPEE_OFFICIAL_PROVIDER_BLOCKED',
    ],
    [{ WHATSAPP_PROVIDER: 'mock' }, 'COMMERCIAL_CONFIRM_EVOLUTION_REQUIRED'],
    [{ EVOLUTION_SAFE_MODE: 'false' }, 'COMMERCIAL_SAFE_MODE_REQUIRED'],
    [
      {
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_CRON: '0 8 * * *',
        SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
      },
      'COMMERCIAL_SCHEDULER_BLOCKED',
    ],
    [{ WHATSAPP_GROUP_SEND_ENABLED: 'false' }, 'GROUP_SEND_DISABLED'],
    [
      { WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '2' },
      'COMMERCIAL_MESSAGE_LIMIT_INVALID',
    ],
    [
      { EVOLUTION_MAX_MESSAGES_PER_BOOT: '2' },
      'COMMERCIAL_MESSAGE_LIMIT_INVALID',
    ],
  ])('bloqueia ambiente inseguro: %s', (changes, code) => {
    const env = { ...baseEnv, ...changes };
    expect(() =>
      assertCommercialConfirmEnvironment(loadConfig(env), env),
    ).toThrow(expect.objectContaining({ code }));
  });

  it('executa um unico job e encerra com SENT/attemptCount 1', async () => {
    const fake = runtime();
    const result = await executeCommercialConfirm({
      runId: 'run-id',
      runtime: fake,
    });
    expect(result).toMatchObject({
      exitCode: 0,
      output: {
        status: 'sent',
        attempts: 1,
        retryEnabled: false,
        messagesSent: 1,
      },
    });
    expect(fake.confirm).toHaveBeenCalledTimes(1);
    expect(fake.waitForJob).toHaveBeenCalledTimes(1);
    expect(fake.markInvestigationRequired).not.toHaveBeenCalled();
    expect(fake.close).toHaveBeenCalledWith(false);
  });

  it('timeout marca investigacao e nunca repete confirmacao ou job', async () => {
    const fake = runtime(
      publicRun({
        status: 'failed',
        finalStatus: 'ambiguous',
        dispatchStatus: 'pending',
        externalMessageIdRecorded: false,
        investigationRequired: true,
      }),
    );
    fake.waitForJob.mockRejectedValueOnce(new Error('timeout'));
    const result = await executeCommercialConfirm({
      runId: 'run-id',
      runtime: fake,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      output: { investigationRequired: true, messagesSent: 'unknown' },
    });
    expect(fake.confirm).toHaveBeenCalledTimes(1);
    expect(fake.waitForJob).toHaveBeenCalledTimes(1);
    expect(fake.markInvestigationRequired).toHaveBeenCalledTimes(1);
    expect(fake.close).toHaveBeenCalledWith(true);
  });

  it('carrega ambiente ignorado sem imprimi-lo e usa runtime injetado', async () => {
    const fake = runtime();
    const logger = { info: vi.fn(), error: vi.fn() };
    const result = await runCommercialConfirm({
      args: ['--run-id=run-id', COMMERCIAL_CONFIRM_REAL_FLAG],
      env: baseEnv,
      envPath: 'missing-local-env-for-test',
      logger,
      runtimeFactory: async () => fake,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      'local-test-key',
    );
  });

  it('job controlado tem attempts 1, sem backoff e sem remocao', () => {
    expect(CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS).toEqual({
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    expect(CONTROLLED_E2E_WHATSAPP_DISPATCH_JOB_OPTIONS).not.toHaveProperty(
      'backoff',
    );
  });
});
