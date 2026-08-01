import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadShopeeOfficialConfig, createShopeeOfficialPreflightRuntime, executeShopeeOfficialPreflight, type ShopeeOfficialPreflightRuntime } from './shopee-official-preflight';
import type { AppEnv } from '@shopee-auto-affiliate-ai/config';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

export const executeShopeeOfficialCatalogPreflight = async (deps?: {
  config?: AppEnv;
  runtime?: ShopeeOfficialPreflightRuntime;
  environment?: { ci?: string | boolean, databaseUrl?: string };
}) => {
  const config = deps?.config ?? loadShopeeOfficialConfig();

  if (!config.SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED) {
    throw new AppError('Sincronizacao operacional desabilitada', 'SHOPEE_OFFICIAL_CATALOG_SYNC_DISABLED');
  }

  const ci = deps?.environment?.ci ?? process.env.CI;
  if (ci !== undefined && ['true', '1', 'yes', 'on'].includes(String(ci).toLowerCase())) {
    throw new AppError('Execucao bloqueada em ambiente CI', 'SHOPEE_OFFICIAL_CATALOG_CI_BLOCKED');
  }

  const dbUrl = deps?.environment?.databaseUrl ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new AppError('Banco de dados nao configurado', 'SHOPEE_OFFICIAL_CATALOG_LOCAL_DATABASE_REQUIRED');
  }

  try {
    const parsedUrl = new URL(dbUrl);
    if (parsedUrl.protocol !== 'postgresql:' && parsedUrl.protocol !== 'postgres:') {
      throw new AppError('Protocolo de banco invalido', 'SHOPEE_OFFICIAL_CATALOG_LOCAL_DATABASE_REQUIRED');
    }
    const hostname = parsedUrl.hostname.replace(/^\[(.*)\]$/, '$1');
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new AppError('Banco remoto nao permitido', 'SHOPEE_OFFICIAL_CATALOG_LOCAL_DATABASE_REQUIRED');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('URL de banco invalida', 'SHOPEE_OFFICIAL_CATALOG_LOCAL_DATABASE_REQUIRED');
  }

  if (config.NODE_ENV === 'test' && !deps) {
    throw new AppError('Preflight bloqueado em ambiente de teste sem dependencias', 'SHOPEE_OFFICIAL_CATALOG_ENV_INVALID');
  }

  const runtime = deps?.runtime ?? createShopeeOfficialPreflightRuntime(config);
  try {
    const baseResult = await executeShopeeOfficialPreflight({ config, runtime });

    const result = {
      approved: baseResult.approved,
      enabled: config.SHOPEE_OFFICIAL_CATALOG_SYNC_ENABLED,
      provider: baseResult.provider,
      officialUrl: baseResult.officialUrl,
      credentialsConfigured: baseResult.signatureProducible,
      pageSize: config.SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE,
      maxPages: config.SHOPEE_OFFICIAL_CATALOG_MAX_PAGES,
      maximumProducts: config.SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE * config.SHOPEE_OFFICIAL_CATALOG_MAX_PAGES,
      minimumIntervalMs: config.SHOPEE_OFFICIAL_CATALOG_MIN_INTERVAL_MS,
      automationMode: baseResult.commercialMode,
      schedulerEnabled: baseResult.legacySchedulerEnabled,
      commercialSchedulerEnabled: baseResult.commercialSchedulerEnabled,
      groupSendEnabled: baseResult.groupSendEnabled,
      dispatchWorkers: baseResult.dispatchWorkers,
      activeDispatchJobs: baseResult.activeDispatchJobs,
    };

    if (isDirectExecution) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    if (!deps?.runtime) {
      await runtime.close();
    }
  }
};

if (isDirectExecution) {
  executeShopeeOfficialCatalogPreflight().catch((error) => {
    console.error(JSON.stringify({
      event: 'shopee.official.catalog.preflight.failed',
      code: error instanceof AppError ? error.code : 'SHOPEE_OFFICIAL_CATALOG_PREFLIGHT_UNKNOWN_ERROR'
    }));
    process.exitCode = 1;
  });
}
