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
  assertSecondReadEligibility,
  createSanitizedResponseEvidence,
  createSingleOfficialReadFetch,
  executeShopeeOfficialSync,
  parseShopeeOfficialSyncArgs,
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
    firstReadState: vi.fn().mockReturnValue({
      status: 'RESPONSE_RECEIVED',
      httpStatus: 200,
      applicationErrorCode: 'SHOPEE_API_GRAPHQL_ERROR',
    }),
    officialProductCount: vi.fn().mockResolvedValue(0),
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
    expect(() => parseShopeeOfficialSyncArgs([])).toThrowError(
      expect.objectContaining({ code: 'SHOPEE_OFFICIAL_CONFIRMATION_REQUIRED' }),
    );
  });

  it('aceita somente as duas autorizacoes explicitas', () => {
    expect(parseShopeeOfficialSyncArgs(['--confirm-one-real-read'])).toBe(
      'first',
    );
    expect(
      parseShopeeOfficialSyncArgs([
        '--',
        '--confirm-second-real-read-after-fix',
      ]),
    ).toBe('second');
    expect(() =>
      parseShopeeOfficialSyncArgs([
        '--confirm-one-real-read',
        '--confirm-second-real-read-after-fix',
      ]),
    ).toThrow();
  });

  it('bloqueia CI antes do preflight', async () => {
    const fake = runtime();
    await expect(
      executeShopeeOfficialSync({
        attempt: 'first',
        env: { CI: 'true' },
        runtime: fake,
      }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_CI_BLOCKED' });
    expect(fake.preflight).not.toHaveBeenCalled();
  });

  it('retorna somente relatorio sanitizado e preserva estados comerciais', async () => {
    const fake = runtime();
    const result = await executeShopeeOfficialSync({
      attempt: 'first',
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
        attempt: 'first',
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
        attempt: 'first',
        env: {},
        runtime: fake,
      }),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_FORBIDDEN_SIDE_EFFECT' });
  });

  it('revalida efeitos comerciais mesmo quando a leitura falha', async () => {
    const fake = runtime();
    vi.mocked(fake.sync).mockRejectedValueOnce(
      new Error('falha GraphQL sanitizada'),
    );
    await expect(
      executeShopeeOfficialSync({
        attempt: 'first',
        env: {},
        runtime: fake,
      }),
    ).rejects.toThrow('falha GraphQL sanitizada');
    expect(fake.protectedCounts).toHaveBeenCalledTimes(2);
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
    const requestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'ProductOfferV2',
        query:
          'query ProductOfferV2 { productOfferV2(page: 1, limit: 5) { nodes { offerLink } } }',
        variables: {},
      }),
    };
    await guardedFetch(SHOPEE_AFFILIATE_OFFICIAL_API_URL, requestInit);
    await expect(
      guardedFetch(SHOPEE_AFFILIATE_OFFICIAL_API_URL, requestInit),
    ).rejects.toMatchObject({ code: 'SHOPEE_OFFICIAL_MULTIPLE_READS_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(readFileSync(statePath, 'utf8')).toContain('RESPONSE_RECEIVED');

    const nextProcessFetch = vi.fn().mockResolvedValue(new Response('{}'));
    const nextGuard = createSingleOfficialReadFetch({
      fetchImplementation: nextProcessFetch,
      statePath,
    });
    await expect(
      nextGuard(SHOPEE_AFFILIATE_OFFICIAL_API_URL, requestInit),
    ).rejects.toMatchObject({
      code: 'SHOPEE_OFFICIAL_REAL_READ_ALREADY_CLAIMED',
    });
    expect(nextProcessFetch).not.toHaveBeenCalled();
  });

  it('exige evidencia da primeira falha e zero produto para a segunda leitura', () => {
    expect(() =>
      assertSecondReadEligibility({
        firstState: {
          status: 'RESPONSE_RECEIVED',
          httpStatus: 200,
          applicationErrorCode: 'SHOPEE_API_GRAPHQL_ERROR',
        },
        officialProductCount: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertSecondReadEligibility({
        firstState: { status: 'RESPONSE_RECEIVED', httpStatus: 200 },
        officialProductCount: 0,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'SHOPEE_OFFICIAL_SECOND_READ_NOT_ELIGIBLE',
      }),
    );
    expect(() =>
      assertSecondReadEligibility({
        firstState: {
          status: 'RESPONSE_RECEIVED',
          httpStatus: 200,
          applicationErrorCode: 'SHOPEE_API_GRAPHQL_ERROR',
        },
        officialProductCount: 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'SHOPEE_OFFICIAL_SECOND_READ_PRODUCTS_EXIST',
      }),
    );
  });

  it('persiste somente request e erro GraphQL sanitizados', async () => {
    const directory = join(
      process.cwd(),
      '.runtime',
      'shopee-official-contract',
    );
    const suffix = `${process.pid}-${Date.now()}`;
    const statePath = join(directory, `test-second-state-${suffix}.json`);
    const diagnosticPath = join(
      directory,
      `test-second-diagnostic-${suffix}.json`,
    );
    temporaryPaths.push(statePath, diagnosticPath);
    const secret = 'fixture-secret-that-must-not-survive';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [
            {
              message: `invalid signature ${secret}`,
              path: ['productOfferV2'],
              extensions: { code: 10020 },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const guardedFetch = createSingleOfficialReadFetch({
      fetchImplementation: fetchMock,
      statePath,
      diagnosticPath,
      sensitiveValues: ['fixture-app-id', secret],
      justification: 'TESTED_QUERY_FIX',
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    });
    await guardedFetch(SHOPEE_AFFILIATE_OFFICIAL_API_URL, {
      method: 'POST',
      headers: {
        Authorization: 'sensitive-header-value',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationName: 'ProductOfferV2',
        query:
          'query ProductOfferV2($page: Int!, $limit: Int!) { productOfferV2(page: $page, limit: $limit) { nodes { offerLink } pageInfo { page limit hasNextPage scrollId } } }',
        variables: { page: 1, limit: 5 },
      }),
    });
    const artifact = readFileSync(diagnosticPath, 'utf8');
    expect(artifact).toContain('ProductOfferV2');
    expect(artifact).toContain('bodySha256');
    expect(artifact).toContain('authorization');
    expect(artifact).toContain('10020');
    expect(artifact).toContain('Invalid Signature');
    expect(artifact).not.toContain(secret);
    expect(artifact).not.toContain('sensitive-header-value');
    expect(readFileSync(statePath, 'utf8')).toContain(
      'SHOPEE_API_GRAPHQL_ERROR',
    );
  });

  it('permite somente um claim entre processos concorrentes', async () => {
    const statePath = join(
      process.cwd(),
      '.runtime',
      'shopee-official-contract',
      `test-concurrent-second-${process.pid}-${Date.now()}.json`,
    );
    temporaryPaths.push(statePath);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'ProductOfferV2',
        query:
          'query ProductOfferV2 { productOfferV2(page: 1, limit: 5) { nodes { offerLink } } }',
        variables: {},
      }),
    };
    const first = createSingleOfficialReadFetch({
      fetchImplementation: fetchMock,
      statePath,
    });
    const second = createSingleOfficialReadFetch({
      fetchImplementation: fetchMock,
      statePath,
    });
    const results = await Promise.allSettled([
      first(SHOPEE_AFFILIATE_OFFICIAL_API_URL, request),
      second(SHOPEE_AFFILIATE_OFFICIAL_API_URL, request),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('resume sucesso sem persistir offerLink', () => {
    const evidence = createSanitizedResponseEvidence(200, {
      data: {
        productOfferV2: {
          nodes: [{ offerLink: 'https://affiliate.example/private' }],
          pageInfo: {
            page: 1,
            limit: 5,
            hasNextPage: false,
            scrollId: 'opaque',
          },
        },
      },
    });
    expect(evidence).toMatchObject({
      dataPresent: true,
      graphqlErrorCount: 0,
      nodeCount: 1,
      offerLinkPresentCount: 1,
      pageInfoTypes: {
        page: 'number',
        limit: 'number',
        hasNextPage: 'boolean',
        scrollId: 'string',
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('affiliate.example');
  });
});
