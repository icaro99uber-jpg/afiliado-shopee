import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeShopeeOfficialCatalogSyncCli } from '../src/shopee-official-catalog-cli';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

describe('executeShopeeOfficialCatalogSyncCli', () => {
  const config = {
    SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE: 20,
    SHOPEE_OFFICIAL_CATALOG_MAX_PAGES: 3,
    SHOPEE_OFFICIAL_CATALOG_MAX_PRODUCTS: 500,
    DATABASE_URL: 'postgresql://localhost:5432/app',
    SHOPEE_AFFILIATE_API_ENABLED: true,
    SHOPEE_AFFILIATE_API_URL: 'https://open-api.affiliate.shopee.com.br/graphql',
    SHOPEE_AFFILIATE_APP_ID: 'app_id',
    SHOPEE_AFFILIATE_SECRET: 'secret',
    SHOPEE_OFFICIAL_CATALOG_MIN_INTERVAL_MS: 100,
  };

  const preflightApproved = { approved: true };
  const preflightBlocked = { approved: false };
  const mockServiceSync = vi.fn();
  const mockPrismaDisconnect = vi.fn();

  const mockDeps = () => ({
    rawArgs: ['--confirm-local-official-catalog-sync', '--keyword=test'],
    config,
    preflight: Promise.resolve(preflightApproved),
    provider: {},
    offersRepository: {},
    lock: {},
    service: { sync: mockServiceSync },
    prisma: { $disconnect: mockPrismaDisconnect },
    logger: { info: vi.fn(), error: vi.fn() },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  it('executa com sucesso mantendo exitCode zero', async () => {
    mockServiceSync.mockResolvedValueOnce({ status: 'SUCCEEDED', completed: true });
    const deps = mockDeps();
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(0);
    expect(deps.logger.info).toHaveBeenCalledWith(expect.objectContaining({ report: expect.objectContaining({ status: 'SUCCEEDED' }) }), 'Sincronizacao concluida');
  });

  it('define exit code 1 e falha quando parser rejeita (args invalidos)', async () => {
    const deps = mockDeps();
    deps.rawArgs = ['--invalid-flag']; // parser fails
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(1);
    expect(mockServiceSync).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('define exit code 1 e nao cria resources quando preflight falha', async () => {
    const deps = mockDeps();
    deps.preflight = Promise.resolve(preflightBlocked);
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(1);
    expect(mockServiceSync).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it('define exit code 1 em excecao nao tratada no preflight', async () => {
    const deps = mockDeps();
    deps.preflight = Promise.reject(new Error('Preflight boom'));
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(1);
    expect(mockServiceSync).not.toHaveBeenCalled();
  });

  it('define exit code 1 quando sync retorna PARTIAL', async () => {
    mockServiceSync.mockResolvedValueOnce({ status: 'PARTIAL', completed: false });
    const deps = mockDeps();
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(1);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.objectContaining({ report: expect.objectContaining({ status: 'PARTIAL' }) }), 'Sincronizacao parcial');
  });

  it('define exit code 1 quando sync retorna FAILED', async () => {
    mockServiceSync.mockResolvedValueOnce({ status: 'FAILED', completed: false });
    const deps = mockDeps();
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(1);
    expect(deps.logger.error).toHaveBeenCalledWith(expect.objectContaining({ report: expect.objectContaining({ status: 'FAILED' }) }), 'Sincronizacao falhou');
  });

  it('define exit code 1 quando sync lanca excecao', async () => {
    mockServiceSync.mockRejectedValueOnce(new AppError('Sync boom', 'SYNC_ERROR'));
    const deps = mockDeps();
    await executeShopeeOfficialCatalogSyncCli(deps);
    expect(process.exitCode).toBe(1);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SYNC_ERROR' }),
      'Erro fatal na sincronizacao do catalogo'
    );
  });
});
