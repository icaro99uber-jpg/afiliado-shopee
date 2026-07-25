import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { ManualShopeeAffiliateOfferProvider } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { PrismaShopeeOfferRepository } from './prisma-repositories';
import { readShopeeManualImportFile } from './shopee-manual-import';
import { ShopeeOfferSyncService } from './shopee-offer-sync-service';

const CONFIRM_FLAG = '--confirm-import';
const DRY_RUN_FLAG = '--dry-run';
const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

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

const parseArgs = (args: readonly string[]) => {
  const normalized = args.filter((argument) => argument !== '--');
  let file: string | undefined;
  let confirmed = false;
  let explicitDryRun = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (argument === '--file') {
      file = normalized[index + 1];
      index += 1;
    } else if (argument === CONFIRM_FLAG) {
      confirmed = true;
    } else if (argument === DRY_RUN_FLAG) {
      explicitDryRun = true;
    } else {
      throw new AppError(
        'Argumento de importacao invalido',
        'INVALID_IMPORT_FLAG',
      );
    }
  }
  if (!file) throw new AppError('--file e obrigatorio', 'IMPORT_FILE_REQUIRED');
  if (confirmed && explicitDryRun) {
    throw new AppError(
      '--dry-run e --confirm-import sao mutuamente exclusivos',
      'INVALID_IMPORT_FLAG',
    );
  }
  return {
    file: isAbsolute(file) ? file : resolve(REPOSITORY_ROOT, file),
    confirmed,
  };
};

const safeLogger = {
  info: (data: Record<string, unknown>) => console.log(JSON.stringify(data)),
  error: (data: Record<string, unknown>) => console.error(JSON.stringify(data)),
};

export const runShopeeImport = async (args = process.argv.slice(2)) => {
  const { file, confirmed } = parseArgs(args);
  const records = await readShopeeManualImportFile(file);
  const provider = new ManualShopeeAffiliateOfferProvider(records);
  const validated = await provider.listProductOffers({ limit: 100 });

  if (!confirmed) {
    safeLogger.info({
      event: 'shopee.import.validated',
      mode: 'dry-run',
      validRecords: validated.items.length,
      recordsWritten: 0,
    });
    return { mode: 'dry-run' as const, validRecords: validated.items.length };
  }

  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseEnvFile(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const config = loadConfig({ ...fileEnv, ...process.env });
  const prisma = createPrismaClient();
  try {
    const service = new ShopeeOfferSyncService({
      provider,
      offers: new PrismaShopeeOfferRepository(prisma),
      maxOffersPerSync: config.SHOPEE_AFFILIATE_SYNC_LIMIT,
      logger: safeLogger,
    });
    return await service.run({ limit: validated.items.length });
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runShopeeImport().catch((error) => {
    safeLogger.error({
      event: 'shopee.import.failed',
      code: error instanceof AppError ? error.code : 'SHOPEE_IMPORT_FAILED',
      message:
        error instanceof AppError
          ? error.message
          : 'Falha segura na importacao de ofertas',
    });
    process.exitCode = 1;
  });
}
