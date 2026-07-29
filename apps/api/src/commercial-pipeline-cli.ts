import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { MockShopeeAffiliateOfferProvider } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  createCommercialPipelineService,
  createPrismaRepositories,
} from './application-services';
import { ScoreService } from './score-service';
import { ShopeeOfferSyncService } from './shopee-offer-sync-service';
import type {
  CommercialPipelineDryRunResult,
  CommercialPipelineInput,
} from './commercial-pipeline-service';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

const parseEnvFile = (content: string) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        return [key, value];
      }),
  );

export const parseCommercialDryRunArgs = (
  args: readonly string[],
): CommercialPipelineInput => {
  const normalized = args.filter((argument) => argument !== '--');
  const input: CommercialPipelineInput = {};
  for (const argument of normalized) {
    if (argument.startsWith('--source=')) {
      const source = argument.slice('--source='.length).toUpperCase();
      if (!['MOCK', 'MANUAL', 'OFFICIAL'].includes(source))
        throw new AppError('source invalido', 'INVALID_PIPELINE_FILTERS');
      input.source = source as 'MOCK' | 'MANUAL' | 'OFFICIAL';
    } else if (argument.startsWith('--minimum-score=')) {
      input.minimumScore = Number(argument.slice('--minimum-score='.length));
    } else if (argument.startsWith('--campaign=')) {
      input.campaign = argument.slice('--campaign='.length);
    } else {
      throw new AppError(
        'Flag nao permitida no dry-run comercial',
        'INVALID_COMMERCIAL_DRY_RUN_FLAG',
      );
    }
  }
  return input;
};

type CommercialDryRunExecutable = {
  dryRun(
    input: CommercialPipelineInput,
  ): Promise<CommercialPipelineDryRunResult>;
};

export const executeCommercialDryRun = async ({
  input,
  provider,
  schedulerEnabled,
  commercialSchedulerEnabled,
  groupSendEnabled,
  service,
  syncMock,
}: {
  input: CommercialPipelineInput;
  provider: 'mock' | 'manual' | 'official';
  schedulerEnabled: boolean;
  commercialSchedulerEnabled: boolean;
  groupSendEnabled: boolean;
  service: CommercialDryRunExecutable;
  syncMock?: () => Promise<unknown>;
}) => {
  if (provider === 'official' && input.source !== 'OFFICIAL') {
    throw new AppError(
      'Provider official exige source OFFICIAL persistida',
      'SHOPEE_OFFICIAL_PERSISTED_SOURCE_REQUIRED',
    );
  }
  if (schedulerEnabled || commercialSchedulerEnabled || groupSendEnabled) {
    throw new AppError(
      'Scheduler e envio para grupos devem permanecer desativados',
      'COMMERCIAL_DRY_RUN_UNSAFE_ENVIRONMENT',
    );
  }
  if (provider === 'mock' && input.source === 'MOCK') await syncMock?.();
  return service.dryRun(input);
};

const safeLogger = {
  info: (data: Record<string, unknown>) => console.log(JSON.stringify(data)),
  error: (data: Record<string, unknown>) => console.error(JSON.stringify(data)),
};

export const runCommercialDryRun = async (
  args: readonly string[] = process.argv.slice(2),
) => {
  const input = parseCommercialDryRunArgs(args);
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseEnvFile(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const mergedEnv = { ...fileEnv, ...process.env };
  const configuredProvider = String(
    mergedEnv.SHOPEE_AFFILIATE_PROVIDER ?? 'mock',
  ).toLocaleLowerCase();
  const config = loadConfig(mergedEnv);
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  safeLogger.info({
    event: 'commercial-pipeline.cli.config-ready',
    provider: configuredProvider,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
  });
  const prisma = createPrismaClient();
  try {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      safeLogger.error({
        event: 'commercial-pipeline.cli.database-unavailable',
        errorType: error instanceof Error ? error.name : 'UnknownError',
        code:
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : 'UNKNOWN',
      });
      throw new AppError(
        'Banco local indisponivel para o dry-run',
        'COMMERCIAL_DATABASE_UNAVAILABLE',
      );
    }
    safeLogger.info({ event: 'commercial-pipeline.cli.database-ready' });
    const repositories = createPrismaRepositories(prisma);
    const score = new ScoreService({
      products: repositories.products,
      logger: safeLogger,
    });
    const service = createCommercialPipelineService({
      repositories,
      score,
      instanceName: config.EVOLUTION_INSTANCE_NAME ?? 'affiliate-bot',
      subIdPrefix: config.SHOPEE_AFFILIATE_SUB_ID_PREFIX,
      maximumCopyLength: config.COMMERCIAL_COPY_MAX_LENGTH,
      logger: safeLogger,
    });
    const result = await executeCommercialDryRun({
      input: {
        ...input,
        source:
          input.source ??
          (configuredProvider === 'official'
            ? 'OFFICIAL'
            : configuredProvider === 'manual'
              ? 'MANUAL'
              : 'MOCK'),
      },
      provider: configuredProvider as 'mock' | 'manual' | 'official',
      schedulerEnabled: config.SCHEDULER_ENABLED,
      commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
      groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      service,
      syncMock:
        configuredProvider === 'mock'
          ? async () => {
              safeLogger.info({
                event: 'commercial-pipeline.cli.mock-sync-started',
              });
              await new ShopeeOfferSyncService({
                provider: new MockShopeeAffiliateOfferProvider(),
                offers: repositories.shopeeOffers,
                maxOffersPerSync: config.SHOPEE_AFFILIATE_SYNC_LIMIT,
                logger: safeLogger,
              }).run({ limit: config.SHOPEE_AFFILIATE_SYNC_LIMIT });
              safeLogger.info({
                event: 'commercial-pipeline.cli.mock-sync-completed',
              });
            }
          : undefined,
    });
    safeLogger.info({
      event: 'commercial-pipeline.cli.completed',
      result,
    });
    return result;
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

export const runCommercialDryRunMain = async (
  args: readonly string[],
  runner: (args: readonly string[]) => Promise<unknown> = runCommercialDryRun,
) => {
  try {
    await runner(args);
    return 0;
  } catch (error) {
    safeLogger.error({
      event: 'commercial-pipeline.cli.failed',
      code:
        error instanceof AppError ? error.code : 'COMMERCIAL_PIPELINE_FAILED',
      message:
        error instanceof AppError
          ? error.message
          : 'Falha segura no pipeline comercial',
    });
    return 1;
  }
};

if (isDirectExecution) {
  void runCommercialDryRunMain(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
