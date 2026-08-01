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

import { countLocalDispatchWorkers } from './commercial-offer-snapshot-backfill';
import {
  createCommercialPromotionMiningDomainService,
  type CommercialPromotionMiningService,
} from './commercial-promotion-mining-service';
import {
  PrismaCommercialAutomationSettingsRepository,
  PrismaCommercialGroupCampaignRepository,
  PrismaCommercialNicheRepository,
  PrismaCommercialPromotionRepository,
} from './prisma-repositories';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const MINE_CONFIRMATION = '--confirm-local-promotion-mining';

type CommercialPromotionCliMode = 'preview' | 'mine';

const cliError = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const normalizeArgs = (rawArgs: readonly string[]) =>
  rawArgs[0] === '--' ? rawArgs.slice(1) : [...rawArgs];

const parseCampaignId = (value: string | undefined) => {
  const id = value?.trim();
  if (
    !id ||
    id.length > 100 ||
    /\s|@|\/|:/.test(id) ||
    id.toLowerCase().startsWith('grp_')
  ) {
    return cliError(
      'campaign-id deve ser um ID interno valido',
      'COMMERCIAL_PROMOTION_CAMPAIGN_ID_INVALID',
    );
  }
  return id;
};

export const parseCommercialPromotionCliArgs = (
  mode: CommercialPromotionCliMode,
  rawArgs: readonly string[],
) => {
  const args = normalizeArgs(rawArgs);
  const campaignArguments = args.filter((argument) =>
    argument.startsWith('--campaign-id='),
  );
  const confirmations = args.filter(
    (argument) => argument === MINE_CONFIRMATION,
  );
  const allowedCount = mode === 'preview' ? 1 : 2;
  if (
    args.length !== allowedCount ||
    campaignArguments.length !== 1 ||
    confirmations.length !== (mode === 'mine' ? 1 : 0) ||
    args.some(
      (argument) =>
        !argument.startsWith('--campaign-id=') &&
        argument !== MINE_CONFIRMATION,
    )
  ) {
    return cliError(
      'Argumentos da mineracao comercial sao invalidos',
      'COMMERCIAL_PROMOTION_CLI_ARGUMENTS_INVALID',
    );
  }
  return {
    mode,
    campaignId: parseCampaignId(campaignArguments[0]?.slice(14)),
  };
};

export type CommercialPromotionMineEnvironment = {
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

const localDatabase = (databaseUrl: string) => {
  try {
    const hostname = new URL(databaseUrl).hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
};

export const assertCommercialPromotionMineEnvironment = (
  environment: CommercialPromotionMineEnvironment,
) => {
  if (environment.ci || !localDatabase(environment.databaseUrl)) {
    cliError(
      'Mineracao permitida somente em banco local fora de CI',
      'COMMERCIAL_PROMOTION_LOCAL_ENVIRONMENT_REQUIRED',
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
    cliError(
      'Mineracao exige automacao pausada e ambiente preview seguro',
      'COMMERCIAL_PROMOTION_UNSAFE_ENVIRONMENT',
    );
  }
  if (environment.dispatchWorkers !== 0) {
    cliError(
      'Mineracao exige zero worker de dispatch',
      'COMMERCIAL_PROMOTION_DISPATCH_WORKER_ACTIVE',
    );
  }
};

export const executeCommercialPromotionCli = async ({
  mode,
  args,
  service,
  environment,
}: {
  mode: CommercialPromotionCliMode;
  args: readonly string[];
  service: Pick<CommercialPromotionMiningService, 'preview' | 'mine'>;
  environment?: CommercialPromotionMineEnvironment;
}) => {
  const parsed = parseCommercialPromotionCliArgs(mode, args);
  if (mode === 'preview') return service.preview(parsed.campaignId, undefined);
  if (!environment) {
    return cliError(
      'Ambiente da mineracao nao foi validado',
      'COMMERCIAL_PROMOTION_UNSAFE_ENVIRONMENT',
    );
  }
  assertCommercialPromotionMineEnvironment(environment);
  return service.mine(parsed.campaignId, { confirm: 'MINERAR_PROMOCOES' });
};

export const runCommercialPromotionCli = async (
  rawArgs: readonly string[] = process.argv.slice(2),
) => {
  const [modeValue, ...args] = rawArgs;
  if (modeValue !== 'preview' && modeValue !== 'mine') {
    return cliError(
      'Comando de mineracao invalido',
      'COMMERCIAL_PROMOTION_CLI_ARGUMENTS_INVALID',
    );
  }
  const parsedArgs = parseCommercialPromotionCliArgs(modeValue, args);
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseDotEnv(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const config = loadConfig({ ...fileEnv, ...process.env });
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const prisma = createPrismaClient();
  try {
    const promotions = new PrismaCommercialPromotionRepository(prisma);
    const service = createCommercialPromotionMiningDomainService({
      campaigns: new PrismaCommercialGroupCampaignRepository(prisma),
      niches: new PrismaCommercialNicheRepository(prisma),
      promotions,
      score: { calculate: () => 0 },
    });
    if (modeValue === 'preview') {
      return service.preview(parsedArgs.campaignId, undefined);
    }
    const settings = await new PrismaCommercialAutomationSettingsRepository(
      prisma,
    ).get();
    return executeCommercialPromotionCli({
      mode: 'mine',
      args,
      service,
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
    });
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runCommercialPromotionCli()
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          completed: false,
          code:
            error instanceof AppError
              ? error.code
              : 'COMMERCIAL_PROMOTION_CLI_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
