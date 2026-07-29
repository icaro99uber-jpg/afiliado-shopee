import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadConfig,
  parseDotEnv,
  type AppEnv,
} from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  SHOPEE_AFFILIATE_OFFICIAL_API_URL,
  ShopeeAffiliateSha256Signer,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
} from '@shopee-auto-affiliate-ai/queue';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { PrismaCommercialAutomationSettingsRepository } from './prisma-repositories';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

export type ShopeeOfficialPreflightResult = {
  approved: true;
  provider: 'official';
  apiEnabled: true;
  officialUrl: true;
  signatureProducible: true;
  clockValid: true;
  legacySchedulerEnabled: false;
  commercialSchedulerEnabled: false;
  commercialAutomationEnabled: false;
  commercialAutomationPaused: true;
  commercialMode: 'preview';
  groupSendEnabled: false;
  dispatchWorkers: 0;
  activeDispatchJobs: 0;
};

export type ShopeeOfficialPreflightRuntime = {
  automationPaused(): Promise<boolean>;
  dispatchActivity(): Promise<{ workers: number; activeJobs: number }>;
  close(): Promise<void>;
};

const blocked = (code: string, message: string) => new AppError(message, code);

export const assertShopeeOfficialStaticPreflight = (
  config: AppEnv,
  clock: () => Date = () => new Date(),
) => {
  if (
    config.SHOPEE_AFFILIATE_PROVIDER !== 'official' ||
    !config.SHOPEE_AFFILIATE_API_ENABLED
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_CONFIGURATION_REQUIRED',
      'Provider official habilitado e obrigatorio',
    );
  }
  if (config.SHOPEE_AFFILIATE_API_URL !== SHOPEE_AFFILIATE_OFFICIAL_API_URL) {
    throw blocked(
      'SHOPEE_OFFICIAL_URL_REQUIRED',
      'URL oficial da Shopee invalida',
    );
  }
  if (
    config.COMMERCIAL_AUTOMATION_MODE !== 'preview' ||
    config.COMMERCIAL_SCHEDULER_ENABLED ||
    config.SCHEDULER_ENABLED ||
    config.COMMERCIAL_AUTOMATION_ENABLED ||
    config.WHATSAPP_GROUP_SEND_ENABLED
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_UNSAFE_ENVIRONMENT',
      'Ambiente operacional nao esta no modo seguro exigido',
    );
  }
  const now = clock();
  const timestamp = Math.floor(now.getTime() / 1_000);
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    now.getUTCFullYear() < 2024 ||
    now.getUTCFullYear() > 2100
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_CLOCK_INVALID',
      'Relogio local invalido para a API Shopee',
    );
  }
  new ShopeeAffiliateSha256Signer({
    appId: config.SHOPEE_AFFILIATE_APP_ID as string,
    secret: config.SHOPEE_AFFILIATE_SECRET as string,
  }).sign({ payload: '{"query":"query Preflight { __typename }"}', timestamp });
};

export const createShopeeOfficialPreflightRuntime = (
  config: AppEnv,
): ShopeeOfficialPreflightRuntime => {
  const prisma = createPrismaClient();
  const settings = new PrismaCommercialAutomationSettingsRepository(prisma);
  const redis = createRedisConnection(config.REDIS_URL);
  const queue = createWhatsAppDispatchQueue(redis);
  return {
    async automationPaused() {
      return (await settings.get())?.paused === true;
    },
    async dispatchActivity() {
      const [workers, activeJobs] = await Promise.all([
        queue.getWorkers(),
        queue.getActiveCount(),
      ]);
      return { workers: workers.length, activeJobs };
    },
    async close() {
      await Promise.allSettled([
        queue.close(),
        redis.quit().then(() => undefined),
        prisma.$disconnect(),
      ]);
    },
  };
};

export const executeShopeeOfficialPreflight = async ({
  config,
  runtime,
  clock = () => new Date(),
}: {
  config: AppEnv;
  runtime: ShopeeOfficialPreflightRuntime;
  clock?: () => Date;
}): Promise<ShopeeOfficialPreflightResult> => {
  assertShopeeOfficialStaticPreflight(config, clock);
  let paused: boolean;
  try {
    paused = await runtime.automationPaused();
  } catch {
    throw blocked(
      'SHOPEE_OFFICIAL_DATABASE_UNAVAILABLE',
      'Banco local indisponivel para o preflight',
    );
  }
  if (!paused) {
    throw blocked(
      'SHOPEE_OFFICIAL_AUTOMATION_PAUSE_REQUIRED',
      'Automacao comercial deve permanecer pausada',
    );
  }
  let activity: { workers: number; activeJobs: number };
  try {
    activity = await runtime.dispatchActivity();
  } catch {
    throw blocked(
      'SHOPEE_OFFICIAL_REDIS_UNAVAILABLE',
      'Redis local indisponivel para o preflight',
    );
  }
  if (activity.workers > 0 || activity.activeJobs > 0) {
    throw blocked(
      'SHOPEE_OFFICIAL_DISPATCH_ACTIVITY_BLOCKED',
      'Worker ou job de dispatch ativo',
    );
  }
  return {
    approved: true,
    provider: 'official',
    apiEnabled: true,
    officialUrl: true,
    signatureProducible: true,
    clockValid: true,
    legacySchedulerEnabled: false,
    commercialSchedulerEnabled: false,
    commercialAutomationEnabled: false,
    commercialAutomationPaused: true,
    commercialMode: 'preview',
    groupSendEnabled: false,
    dispatchWorkers: 0,
    activeDispatchJobs: 0,
  };
};

export const loadShopeeOfficialConfig = (
  env = process.env,
  envPath = ROOT_ENV_PATH,
) => {
  const fileEnv = existsSync(envPath)
    ? parseDotEnv(readFileSync(envPath, 'utf8'))
    : {};
  return loadConfig({ ...fileEnv, ...env });
};

export const runShopeeOfficialPreflight = async ({
  env = process.env,
  envPath = ROOT_ENV_PATH,
  runtimeFactory = createShopeeOfficialPreflightRuntime,
}: {
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  runtimeFactory?: (config: AppEnv) => ShopeeOfficialPreflightRuntime;
} = {}) => {
  const config = loadShopeeOfficialConfig(env, envPath);
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const runtime = runtimeFactory(config);
  try {
    return await executeShopeeOfficialPreflight({ config, runtime });
  } finally {
    await runtime.close();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runShopeeOfficialPreflight()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          approved: false,
          code:
            error instanceof AppError
              ? error.code
              : 'SHOPEE_OFFICIAL_PREFLIGHT_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
