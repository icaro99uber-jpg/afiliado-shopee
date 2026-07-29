import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadConfig,
  parseDotEnv,
  type AppEnv,
} from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  PrismaCommercialAutomationSettingsRepository,
  PrismaShopeeOfferRepository,
} from './prisma-repositories';
import type { CommercialOfferSnapshotBackfillRepository } from './repositories';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const CONFIRMATION = '--confirm-local-official-backfill';
const BATCH_SIZE = 100;

export type CommercialOfferSnapshotBackfillReport = {
  officialProductsFound: number;
  alreadyInitialized: number;
  initialized: number;
  snapshotsCreated: number;
  remaining: number;
  completed: boolean;
};

const blocked = (code: string, message: string) => new AppError(message, code);

export const assertCommercialOfferSnapshotBackfillArgs = (
  rawArgs: readonly string[],
) => {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  if (args.length !== 1 || args[0] !== CONFIRMATION) {
    throw blocked(
      'COMMERCIAL_SNAPSHOT_BACKFILL_CONFIRMATION_REQUIRED',
      `Backfill exige somente ${CONFIRMATION}`,
    );
  }
};

export type CommercialOfferSnapshotBackfillEnvironment = {
  ci: boolean;
  databaseUrl: string;
  automationMode: AppEnv['COMMERCIAL_AUTOMATION_MODE'];
  automationEnabled: boolean;
  automationPaused: boolean;
  schedulerEnabled: boolean;
  commercialSchedulerEnabled: boolean;
  groupSendEnabled: boolean;
  dispatchWorkers: number;
};

const isLocalDatabaseUrl = (databaseUrl: string) => {
  try {
    const hostname = new URL(databaseUrl).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
};

export const assertCommercialOfferSnapshotBackfillEnvironment = (
  environment: CommercialOfferSnapshotBackfillEnvironment,
) => {
  if (environment.ci || !isLocalDatabaseUrl(environment.databaseUrl)) {
    throw blocked(
      'COMMERCIAL_SNAPSHOT_BACKFILL_LOCAL_REQUIRED',
      'Backfill permitido somente no ambiente local fora de CI',
    );
  }
  if (
    environment.automationMode !== 'preview' ||
    environment.automationEnabled ||
    !environment.automationPaused ||
    environment.schedulerEnabled ||
    environment.commercialSchedulerEnabled ||
    environment.groupSendEnabled
  ) {
    throw blocked(
      'COMMERCIAL_SNAPSHOT_BACKFILL_UNSAFE_ENVIRONMENT',
      'Backfill exige automacao pausada e ambiente preview seguro',
    );
  }
  if (environment.dispatchWorkers !== 0) {
    throw blocked(
      'COMMERCIAL_SNAPSHOT_BACKFILL_DISPATCH_WORKER_ACTIVE',
      'Backfill exige zero worker de dispatch',
    );
  }
};

export const countLocalDispatchWorkers = () => {
  const marker = 'whatsapp-dispatch-runtime.ts';
  if (process.platform === 'win32') {
    const command =
      '$count=@(Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | ' +
      `Where-Object { $_.CommandLine -like '*${marker}*' }).Count; ` +
      'Write-Output $count';
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', windowsHide: true },
    );
    const count = Number(result.stdout.trim());
    if (result.status !== 0 || !Number.isInteger(count) || count < 0) {
      throw blocked(
        'COMMERCIAL_SNAPSHOT_BACKFILL_WORKER_CHECK_FAILED',
        'Nao foi possivel verificar workers locais de dispatch',
      );
    }
    return count;
  }
  const result = spawnSync('ps', ['-eo', 'comm=,args='], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw blocked(
      'COMMERCIAL_SNAPSHOT_BACKFILL_WORKER_CHECK_FAILED',
      'Nao foi possivel verificar workers locais de dispatch',
    );
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => /^\s*node(?:\s|$)/i.test(line) && line.includes(marker))
    .length;
};

export const executeCommercialOfferSnapshotBackfill = async ({
  args,
  environment,
  repository,
}: {
  args: readonly string[];
  environment: CommercialOfferSnapshotBackfillEnvironment;
  repository: CommercialOfferSnapshotBackfillRepository;
}): Promise<CommercialOfferSnapshotBackfillReport> => {
  assertCommercialOfferSnapshotBackfillArgs(args);
  assertCommercialOfferSnapshotBackfillEnvironment(environment);
  const officialProductsFound = await repository.countOfficialProducts();
  const pendingAtStart =
    await repository.countOfficialProductsPendingSnapshot();
  let initialized = 0;

  while (true) {
    const productIds =
      await repository.listOfficialProductIdsPendingSnapshot(BATCH_SIZE);
    if (productIds.length === 0) break;
    let batchProgress = 0;
    for (const productId of productIds) {
      if (await repository.initializeOfficialProductSnapshot(productId)) {
        initialized += 1;
        batchProgress += 1;
      }
    }
    if (batchProgress === 0) {
      const pending = await repository.countOfficialProductsPendingSnapshot();
      if (pending > 0) {
        throw blocked(
          'COMMERCIAL_SNAPSHOT_BACKFILL_NO_PROGRESS',
          'Backfill nao avancou sobre os registros pendentes',
        );
      }
    }
  }

  const remaining = await repository.countOfficialProductsPendingSnapshot();
  return {
    officialProductsFound,
    alreadyInitialized: officialProductsFound - pendingAtStart,
    initialized,
    snapshotsCreated: initialized,
    remaining,
    completed: remaining === 0,
  };
};

export const runCommercialOfferSnapshotBackfill = async (
  args: readonly string[] = process.argv.slice(2),
) => {
  assertCommercialOfferSnapshotBackfillArgs(args);
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseDotEnv(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const config = loadConfig({ ...fileEnv, ...process.env });
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const prisma = createPrismaClient();
  try {
    const settings = await new PrismaCommercialAutomationSettingsRepository(
      prisma,
    ).get();
    return await executeCommercialOfferSnapshotBackfill({
      args,
      environment: {
        ci: Boolean(process.env.CI),
        databaseUrl: config.DATABASE_URL,
        automationMode: config.COMMERCIAL_AUTOMATION_MODE,
        automationEnabled: config.COMMERCIAL_AUTOMATION_ENABLED,
        automationPaused: settings?.paused === true,
        schedulerEnabled: config.SCHEDULER_ENABLED,
        commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
        groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
        dispatchWorkers: countLocalDispatchWorkers(),
      },
      repository: new PrismaShopeeOfferRepository(prisma),
    });
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runCommercialOfferSnapshotBackfill()
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          completed: false,
          code:
            error instanceof AppError
              ? error.code
              : 'COMMERCIAL_SNAPSHOT_BACKFILL_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
