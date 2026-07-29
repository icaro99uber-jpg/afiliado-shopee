import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { SHOPEE_AFFILIATE_OFFICIAL_API_URL } from '@shopee-auto-affiliate-ai/providers';
import {
  configureShopeeOfficial,
  updateOfficialEnvContents,
} from '../src/shopee-official-configure';
import {
  executeShopeeOfficialPreflight,
  type ShopeeOfficialPreflightRuntime,
} from '../src/shopee-official-preflight';
import {
  createSingleOfficialReadFetch,
  executeShopeeOfficialSync,
  type ShopeeOfficialSyncRuntime,
} from '../src/shopee-official-sync';

const temporaryPaths: string[] = [];
afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const safeConfig = (overrides: NodeJS.ProcessEnv = {}): AppEnv =>
  loadConfig({
    DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/local',
    REDIS_URL: 'redis://127.0.0.1:6379',
    SHOPEE_AFFILIATE_PROVIDER: 'official',
    SHOPEE_AFFILIATE_API_ENABLED: 'true',
    SHOPEE_AFFILIATE_APP_ID: 'fixture-app-id',
    SHOPEE_AFFILIATE_SECRET: 'fixture-secret',
    SHOPEE_AFFILIATE_API_URL: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
    COMMERCIAL_AUTOMATION_MODE: 'preview',
    COMMERCIAL_SCHEDULER_ENABLED: 'false',
    COMMERCIAL_AUTOMATION_ENABLED: 'false',
    SCHEDULER_ENABLED: 'false',
    SCHEDULER_CRON: '0 9 * * *',
    SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
    WHATSAPP_GROUP_SEND_ENABLED: 'false',
    ...overrides,
  });

describe('shopee:official:configure', () => {
  it('preserva variaveis e comentarios, remove duplicata e nao retorna segredo', async () => {
    const secret = 'fixture-secret-never-print';
    const updated = updateOfficialEnvContents(
      [
        '# comentario preservado',
        'DATABASE_URL=postgresql://local',
        'SHOPEE_AFFILIATE_APP_ID=old',
        'SHOPEE_AFFILIATE_APP_ID=duplicate-old',
        '',
      ].join('\n'),
      { appId: 'new-app-id', secret },
    );
    expect(updated).toContain('# comentario preservado');
    expect(updated).toContain('DATABASE_URL=postgresql://local');
    expect(updated.match(/SHOPEE_AFFILIATE_APP_ID=/g)).toHaveLength(1);
    expect(updated).toContain(`SHOPEE_AFFILIATE_SECRET=${secret}`);

    const directory = mkdtempSync(join(tmpdir(), 'shopee-configure-'));
    temporaryPaths.push(directory);
    const envPath = join(directory, '.env');
    writeFileSync(join(directory, '.gitignore'), '.env\n', 'utf8');
    expect(
      spawnSync('git', ['init', '--quiet'], {
        cwd: directory,
        windowsHide: true,
      }).status,
    ).toBe(0);
    writeFileSync(
      envPath,
      '# existente\nDATABASE_URL=postgresql://local\n',
      'utf8',
    );
    const result = await configureShopeeOfficial({
      args: [],
      env: {},
      root: directory,
      prompt: async () => ({ appId: 'new-app-id', secret }),
    });
    expect(result).not.toHaveProperty('appId');
    expect(result).not.toHaveProperty('secret');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(readFileSync(envPath, 'utf8')).toContain(
      'SHOPEE_AFFILIATE_PROVIDER=official',
    );
    expect(readFileSync(envPath, 'utf8')).toContain('# existente');
    expect([...readFileSync(envPath).subarray(0, 3)]).not.toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });

  it('bloqueia CI antes de solicitar credenciais', async () => {
    const prompt = vi.fn();
    await expect(
      configureShopeeOfficial({ env: { CI: 'true' }, prompt }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_CI_BLOCKED' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('rejeita argumentos antes de solicitar credenciais', async () => {
    const prompt = vi.fn();
    await expect(
      configureShopeeOfficial({ args: ['valor-proibido'], env: {}, prompt }),
    ).rejects.toMatchObject({
      code: 'SHOPEE_OFFICIAL_CONFIGURATION_ARGUMENTS_BLOCKED',
    });
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('shopee:official:preflight', () => {
  const runtime = (
    paused = true,
    activity = { workers: 0, activeJobs: 0 },
  ): ShopeeOfficialPreflightRuntime => ({
    automationPaused: vi.fn().mockResolvedValue(paused),
    dispatchActivity: vi.fn().mockResolvedValue(activity),
    close: vi.fn().mockResolvedValue(undefined),
  });

  it('aprova somente configuracao segura, pausa e ausencia de dispatch', async () => {
    const result = await executeShopeeOfficialPreflight({
      config: safeConfig(),
      runtime: runtime(),
      clock: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    expect(result).toMatchObject({
      approved: true,
      commercialMode: 'preview',
      commercialAutomationPaused: true,
      dispatchWorkers: 0,
      activeDispatchJobs: 0,
    });
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    expect(JSON.stringify(result)).not.toContain('fixture-app-id');
  });

  it.each([
    [{ COMMERCIAL_SCHEDULER_ENABLED: 'true' }],
    [{ COMMERCIAL_AUTOMATION_ENABLED: 'true' }],
    [{ SCHEDULER_ENABLED: 'true' }],
    [{ WHATSAPP_GROUP_SEND_ENABLED: 'true' }],
  ])('bloqueia ambiente inseguro %j', async (override) => {
    await expect(
      executeShopeeOfficialPreflight({
        config: safeConfig(override),
        runtime: runtime(),
      }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_UNSAFE_ENVIRONMENT' });
  });

  it('bloqueia automacao sem pausa e qualquer atividade de dispatch', async () => {
    await expect(
      executeShopeeOfficialPreflight({
        config: safeConfig(),
        runtime: runtime(false),
      }),
    ).rejects.toMatchObject({
      code: 'SHOPEE_OFFICIAL_AUTOMATION_PAUSE_REQUIRED',
    });
    await expect(
      executeShopeeOfficialPreflight({
        config: safeConfig(),
        runtime: runtime(true, { workers: 1, activeJobs: 0 }),
      }),
    ).rejects.toMatchObject({
      code: 'SHOPEE_OFFICIAL_DISPATCH_ACTIVITY_BLOCKED',
    });
  });
});

describe('shopee:official:sync', () => {
  const counts = {
    commercialPipelineRuns: 2,
    commercialAutomationExecutions: 3,
    whatsappDispatches: 4,
    commercialDispatchOutboxes: 5,
  };
  const runtime = (
    reportOverrides: Record<string, unknown> = {},
  ): ShopeeOfficialSyncRuntime => ({
    preflight: vi.fn().mockResolvedValue(undefined),
    protectedCounts: vi.fn().mockResolvedValue(counts),
    sync: vi.fn().mockResolvedValue({
      source: 'official',
      fetched: 5,
      valid: 4,
      created: 3,
      updated: 1,
      rejected: 1,
      skipped: 0,
      expired: 0,
      hasNextPage: true,
      affiliateLinkPresentCount: 4,
      ...reportOverrides,
    }),
    close: vi.fn().mockResolvedValue(undefined),
  });

  it('exige flag exata antes do preflight', async () => {
    const fake = runtime();
    await expect(
      executeShopeeOfficialSync({ args: [], env: {}, runtime: fake }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_CONFIRMATION_REQUIRED' });
    expect(fake.preflight).not.toHaveBeenCalled();
  });

  it('bloqueia CI antes do preflight', async () => {
    const fake = runtime();
    await expect(
      executeShopeeOfficialSync({
        args: ['--confirm-one-real-read'],
        env: { CI: 'true' },
        runtime: fake,
      }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_CI_BLOCKED' });
    expect(fake.preflight).not.toHaveBeenCalled();
  });

  it('retorna somente relatorio sanitizado e preserva estados comerciais', async () => {
    const fake = runtime();
    const result = await executeShopeeOfficialSync({
      args: ['--', '--confirm-one-real-read'],
      env: {},
      runtime: fake,
    });
    expect(result).toEqual({
      fetched: 5,
      valid: 4,
      created: 3,
      updated: 1,
      rejected: 1,
      expired: 0,
      hasNextPage: true,
      affiliateLinkPresentCount: 4,
      realRequests: 1,
      maximumProducts: 5,
    });
    expect(fake.preflight).toHaveBeenCalledOnce();
    expect(fake.protectedCounts).toHaveBeenCalledTimes(2);
    expect(fake.sync).toHaveBeenCalledOnce();
  });

  it('bloqueia mais de cinco produtos e efeitos comerciais', async () => {
    await expect(
      executeShopeeOfficialSync({
        args: ['--confirm-one-real-read'],
        env: {},
        runtime: runtime({ fetched: 6 }),
      }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_LIMIT_EXCEEDED' });

    const fake = runtime();
    vi.mocked(fake.protectedCounts)
      .mockResolvedValueOnce(counts)
      .mockResolvedValueOnce({ ...counts, whatsappDispatches: 6 });
    await expect(
      executeShopeeOfficialSync({
        args: ['--confirm-one-real-read'],
        env: {},
        runtime: fake,
      }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_FORBIDDEN_SIDE_EFFECT' });
  });

  it('faz uma unica chamada HTTP e bloqueia repeticao local', async () => {
    const statePath = join(
      process.cwd(),
      '.runtime',
      'shopee-official-contract',
      `test-real-read-${process.pid}-${Date.now()}.json`,
    );
    temporaryPaths.push(statePath);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    const guardedFetch = createSingleOfficialReadFetch({
      fetchImplementation: fetchMock,
      statePath,
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    await guardedFetch(SHOPEE_AFFILIATE_OFFICIAL_API_URL);
    await expect(
      guardedFetch(SHOPEE_AFFILIATE_OFFICIAL_API_URL),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_MULTIPLE_READS_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readFileSync(statePath, 'utf8')).toContain('RESPONSE_RECEIVED');

    const nextProcessFetch = vi.fn().mockResolvedValue(new Response('{}'));
    const nextGuard = createSingleOfficialReadFetch({
      fetchImplementation: nextProcessFetch,
      statePath,
    });
    await expect(
      nextGuard(SHOPEE_AFFILIATE_OFFICIAL_API_URL),
    ).rejects.toMatchObject({
      code: 'SHOPEE_OFFICIAL_REAL_READ_ALREADY_CLAIMED',
    });
    expect(nextProcessFetch).not.toHaveBeenCalled();
  });
});
