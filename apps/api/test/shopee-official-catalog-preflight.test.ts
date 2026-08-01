import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeShopeeOfficialCatalogPreflight } from '../src/shopee-official-catalog-preflight';
import { envSchema } from '@shopee-auto-affiliate-ai/config';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ShopeeOfficialPreflightRuntime } from '../src/shopee-official-preflight';
import * as shopeeOfficialPreflightModule from '../src/shopee-official-preflight';

const baseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED: 'true',
  SHOPEE_AFFILIATE_PROVIDER: 'official',
  SHOPEE_AFFILIATE_API_ENABLED: 'true',
  SHOPEE_AFFILIATE_API_URL: 'https://open-api.affiliate.shopee.com.br/graphql',
  SHOPEE_AFFILIATE_APP_ID: 'app_id',
  SHOPEE_AFFILIATE_SECRET: 'secret',
  COMMERCIAL_AUTOMATION_MODE: 'preview',
  COMMERCIAL_AUTOMATION_ENABLED: 'false',
  SCHEDULER_ENABLED: 'false',
  COMMERCIAL_SCHEDULER_ENABLED: 'false',
  WHATSAPP_GROUP_SEND_ENABLED: 'false',
};

describe('executeShopeeOfficialCatalogPreflight', () => {
  const mockRuntime: ShopeeOfficialPreflightRuntime = {
    automationPaused: vi.fn().mockResolvedValue(true),
    dispatchActivity: vi.fn().mockResolvedValue({ workers: 0, activeJobs: 0 }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const runWithEnv = async (overrides: Record<string, string>, ci?: string | boolean, dbUrl?: string, runtimeParam?: ShopeeOfficialPreflightRuntime) => {
    const config = envSchema.parse({ ...baseEnv, ...overrides });
    return executeShopeeOfficialCatalogPreflight({
      config,
      runtime: runtimeParam !== undefined ? runtimeParam : mockRuntime,
      environment: {
        ci,
        databaseUrl: dbUrl ?? config.DATABASE_URL,
      },
    });
  };

  it('aprova ambiente seguro (runtime injetado)', async () => {
    const result = await runWithEnv({});
    expect(result.approved).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.provider).toBe('official');
    expect(result.officialUrl).toBe(true);
    expect(result.credentialsConfigured).toBe(true);
    expect(result.activeDispatchJobs).toBe(0);
    expect(mockRuntime.close).not.toHaveBeenCalled();
  });

  it('runtime real não é substituído por stub falso, é fechado ao final', async () => {
    const fakeRealRuntime: ShopeeOfficialPreflightRuntime = {
      automationPaused: vi.fn().mockResolvedValue(true),
      dispatchActivity: vi.fn().mockResolvedValue({ workers: 0, activeJobs: 0 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const spyCreate = vi.spyOn(shopeeOfficialPreflightModule, 'createShopeeOfficialPreflightRuntime').mockReturnValue(fakeRealRuntime);
    const config = envSchema.parse({ ...baseEnv });

    const result = await executeShopeeOfficialCatalogPreflight({
      config,
      environment: {
        ci: false,
        databaseUrl: config.DATABASE_URL,
      },
    });

    expect(result.approved).toBe(true);
    expect(spyCreate).toHaveBeenCalled();
    expect(fakeRealRuntime.close).toHaveBeenCalledOnce();

    spyCreate.mockRestore();
  });

  it('bloqueia se automationPaused=false', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRuntime.automationPaused as any).mockResolvedValueOnce(false);
    await expect(runWithEnv({})).rejects.toThrowError(
      new AppError('Automacao comercial deve permanecer pausada', 'SHOPEE_OFFICIAL_AUTOMATION_NOT_PAUSED')
    );
  });

  it('bloqueia se worker ativo', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRuntime.dispatchActivity as any).mockResolvedValueOnce({ workers: 1, activeJobs: 0 });
    await expect(runWithEnv({})).rejects.toThrowError(
      new AppError('Worker ou job de dispatch ativo', 'SHOPEE_OFFICIAL_DISPATCH_ACTIVITY_DETECTED')
    );
  });

  it('bloqueia se active job', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRuntime.dispatchActivity as any).mockResolvedValueOnce({ workers: 0, activeJobs: 1 });
    await expect(runWithEnv({})).rejects.toThrowError(
      new AppError('Worker ou job de dispatch ativo', 'SHOPEE_OFFICIAL_DISPATCH_ACTIVITY_DETECTED')
    );
  });

  it('resultado aprovado inclui activeDispatchJobs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockRuntime.dispatchActivity as any).mockResolvedValueOnce({ workers: 0, activeJobs: 0 });
    const result = await runWithEnv({});
    expect(result.activeDispatchJobs).toBe(0);
  });

  it('bloqueia se desabilitado', async () => {
    await expect(runWithEnv({ SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED: 'false' }))
      .rejects.toThrowError(new AppError('Sincronizacao operacional desabilitada', 'SHOPEE_OFFICIAL_CATALOG_SYNC_DISABLED'));
  });

  it.each(['true', '1', 'yes', 'on', true])('bloqueia em CI com %s', async (ciValue) => {
    await expect(runWithEnv({}, ciValue)).rejects.toThrowError(
      new AppError('Execucao bloqueada em ambiente CI', 'SHOPEE_OFFICIAL_CATALOG_CI_BLOCKED')
    );
  });

  it.each([
    ['mysql://localhost/db', 'Protocolo de banco invalido'],
    ['http://localhost/db', 'Protocolo de banco invalido'],
    ['postgresql://remote.host:5432/app', 'Banco remoto nao permitido'],
    ['postgres://192.168.1.1/app', 'Banco remoto nao permitido'],
    ['invalid-url', 'URL de banco invalida'],
  ])('bloqueia banco com %s', async (dbUrl, message) => {
    await expect(runWithEnv({}, undefined, dbUrl)).rejects.toThrowError(
      new AppError(message, 'SHOPEE_OFFICIAL_CATALOG_LOCAL_DATABASE_REQUIRED')
    );
  });

  it.each([
    'postgresql://localhost/db',
    'postgres://127.0.0.1/db',
    'postgresql://[::1]/db',
  ])('permite banco local %s', async (dbUrl) => {
    const result = await runWithEnv({}, undefined, dbUrl);
    expect(result.approved).toBe(true);
  });
});
