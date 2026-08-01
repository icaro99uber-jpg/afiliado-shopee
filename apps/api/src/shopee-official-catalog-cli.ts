import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadShopeeOfficialConfig } from './shopee-official-preflight';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { OfficialShopeeAffiliateOfferProvider } from '@shopee-auto-affiliate-ai/providers';
import { PrismaShopeeOfferRepository } from './prisma-repositories';
import { ShopeeOfficialCatalogSyncService } from './shopee-official-catalog-sync-service';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { FastifyBaseLogger } from 'fastify';
import { parseShopeeOfficialCatalogCliArgs } from './shopee-official-catalog-cli-parser';
import { executeShopeeOfficialCatalogPreflight } from './shopee-official-catalog-preflight';

import { PostgresShopeeOfficialCatalogSyncLock } from './shopee-official-catalog-sync-lock';

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

/* eslint-disable @typescript-eslint/no-explicit-any */
export const executeShopeeOfficialCatalogSyncCli = async (deps?: {
  rawArgs?: string[];
  config?: any;
  preflight?: any;
  provider?: any;
  offersRepository?: any;
  lock?: any;
  service?: any;
  prisma?: any;
  logger?: any;
}) => {
/* eslint-enable @typescript-eslint/no-explicit-any */
  const config = deps?.config ?? loadShopeeOfficialConfig();
  const rawArgs = deps?.rawArgs ?? process.argv.slice(2);
  let parsedArgs;

  try {
    parsedArgs = parseShopeeOfficialCatalogCliArgs(rawArgs, {
      maximumPageSize: config.SHOPEE_OFFICIAL_CATALOG_PAGE_SIZE,
      maximumPages: config.SHOPEE_OFFICIAL_CATALOG_MAX_PAGES,
      maximumProducts: config.SHOPEE_OFFICIAL_CATALOG_MAX_PRODUCTS,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'shopee.official.catalog.sync.cli.failed',
      code: error instanceof AppError ? error.code : 'SHOPEE_OFFICIAL_CATALOG_SYNC_UNKNOWN_ERROR'
    }));
    process.exitCode = 1;
    return;
  }

  const { keyword, categoryId, sort, pageSize, maxPages } = parsedArgs;

  const logger = deps?.logger ?? ({
    info: (obj: unknown, msg?: string) => console.log(JSON.stringify({ level: 'info', msg, ...(obj as object) })),
    error: (obj: unknown, msg?: string) => console.error(JSON.stringify({ level: 'error', msg, ...(obj as object) })),
  } as unknown as Pick<FastifyBaseLogger, 'info' | 'error'>);

  let preflightResult;
  try {
    preflightResult = await (deps?.preflight ?? executeShopeeOfficialCatalogPreflight({
      config,
      environment: {
        ci: process.env.CI,
        databaseUrl: config.DATABASE_URL,
      },
    }));
    if (!preflightResult.approved) {
      throw new AppError('Preflight bloqueou a execucao', 'SHOPEE_OFFICIAL_CATALOG_PREFLIGHT_FAILED');
    }
  } catch (error) {
    logger.error(
      { event: 'shopee.official.catalog.sync.cli.failed', code: error instanceof AppError ? error.code : 'SHOPEE_OFFICIAL_CATALOG_PREFLIGHT_UNKNOWN_ERROR' },
      'Erro no preflight',
    );
    process.exitCode = 1;
    return;
  }

  const prisma = deps?.prisma ?? createPrismaClient();
  const provider = deps?.provider ?? new OfficialShopeeAffiliateOfferProvider({
    apiEnabled: config.SHOPEE_AFFILIATE_API_ENABLED,
    apiUrl: config.SHOPEE_AFFILIATE_API_URL,
    appId: config.SHOPEE_AFFILIATE_APP_ID,
    secret: config.SHOPEE_AFFILIATE_SECRET,
    maximumOffersPerPage: pageSize,
    timeoutMs: 10000,
  });

  const offers = deps?.offersRepository ?? new PrismaShopeeOfferRepository(prisma);
  const lock = deps?.lock ?? new PostgresShopeeOfficialCatalogSyncLock(config.DATABASE_URL);
  const service = deps?.service ?? new ShopeeOfficialCatalogSyncService(provider, offers, lock, logger);

  logger.info(
    {
      event: 'shopee.official.catalog.sync.cli.started',
      keywordPresent: Boolean(keyword),
      categoryId,
      sort,
      pageSize,
      maxPages
    },
    'Iniciando sincronizacao operacional do catalogo Shopee',
  );

  try {
    const report = await service.sync({
      keyword,
      categoryId,
      sort,
      pageSize,
      maxPages,
      minimumIntervalMs: config.SHOPEE_OFFICIAL_CATALOG_MIN_INTERVAL_MS,
    });

    if (report.status === 'SUCCEEDED') {
      logger.info({ report }, 'Sincronizacao concluida');
    } else if (report.status === 'PARTIAL') {
      logger.error({ report }, 'Sincronizacao parcial');
      process.exitCode = 1;
    } else {
      logger.error({ report }, 'Sincronizacao falhou');
      process.exitCode = 1;
    }
  } catch (error) {
    logger.error(
      { event: 'shopee.official.catalog.sync.cli.failed', code: error instanceof AppError ? error.code : 'SHOPEE_OFFICIAL_CATALOG_SYNC_UNKNOWN_ERROR' },
      'Erro fatal na sincronizacao do catalogo',
    );
    process.exitCode = 1;
  } finally {
    if (!deps?.prisma) {
      await prisma.$disconnect();
    }
  }
};

if (isDirectExecution) {
  executeShopeeOfficialCatalogSyncCli().catch(() => {
    process.exitCode = 1;
  });
}
