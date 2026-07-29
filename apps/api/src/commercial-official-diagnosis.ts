import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, parseDotEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  CommercialOfficialDiagnosisService,
  type CommercialOfficialDiagnosisReport,
} from './commercial-official-diagnosis-service';
import {
  PrismaCommercialAutomationSettingsRepository,
  PrismaShopeeOfferRepository,
} from './prisma-repositories';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ROOT_ENV_PATH = resolve(REPOSITORY_ROOT, '.env');
export const OFFICIAL_DIAGNOSIS_PATH = resolve(
  REPOSITORY_ROOT,
  '.runtime/local-system/official-offer-diagnosis.json',
);
const OFFICIAL_DIAGNOSIS_RELATIVE_PATH =
  '.runtime/local-system/official-offer-diagnosis.json';

export const assertCommercialOfficialDiagnosisArgs = (
  args: readonly string[],
) => {
  if (args.length !== 0) {
    throw new AppError(
      'commercial:official:diagnose nao aceita argumentos',
      'COMMERCIAL_OFFICIAL_DIAGNOSIS_ARGUMENTS_INVALID',
    );
  }
};

type CommercialOfficialDiagnosisEnvironment = {
  automationMode: string;
  automationEnabled: boolean;
  automationPaused: boolean;
  schedulerEnabled: boolean;
  commercialSchedulerEnabled: boolean;
  groupSendEnabled: boolean;
};

const assertCommercialOfficialDiagnosisStaticEnvironment = ({
  automationMode,
  automationEnabled,
  schedulerEnabled,
  commercialSchedulerEnabled,
  groupSendEnabled,
}: Omit<CommercialOfficialDiagnosisEnvironment, 'automationPaused'>) => {
  if (
    automationMode !== 'preview' ||
    automationEnabled ||
    schedulerEnabled ||
    commercialSchedulerEnabled ||
    groupSendEnabled
  ) {
    throw new AppError(
      'Diagnostico oficial exige ambiente local pausado em preview',
      'COMMERCIAL_OFFICIAL_DIAGNOSIS_UNSAFE_ENVIRONMENT',
    );
  }
};

export const assertCommercialOfficialDiagnosisEnvironment = (
  environment: CommercialOfficialDiagnosisEnvironment,
) => {
  assertCommercialOfficialDiagnosisStaticEnvironment(environment);
  if (!environment.automationPaused) {
    throw new AppError(
      'Diagnostico oficial exige ambiente local pausado em preview',
      'COMMERCIAL_OFFICIAL_DIAGNOSIS_UNSAFE_ENVIRONMENT',
    );
  }
};

export const assertOfficialDiagnosisPathIgnored = () => {
  const result = spawnSync(
    'git',
    ['check-ignore', '--quiet', '--', OFFICIAL_DIAGNOSIS_RELATIVE_PATH],
    { cwd: REPOSITORY_ROOT, stdio: 'ignore', windowsHide: true },
  );
  if (result.status !== 0) {
    throw new AppError(
      'Destino do diagnostico nao esta ignorado pelo Git',
      'COMMERCIAL_OFFICIAL_DIAGNOSIS_PATH_NOT_IGNORED',
    );
  }
};

const persistDiagnosis = (report: CommercialOfficialDiagnosisReport) => {
  mkdirSync(dirname(OFFICIAL_DIAGNOSIS_PATH), { recursive: true });
  const temporaryPath = `${OFFICIAL_DIAGNOSIS_PATH}.${process.pid}-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporaryPath, OFFICIAL_DIAGNOSIS_PATH);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

export const executeCommercialOfficialDiagnosis = async ({
  args,
  environment,
  automationPaused,
  diagnose,
  persist = persistDiagnosis,
}: {
  args: readonly string[];
  environment: Omit<
    Parameters<typeof assertCommercialOfficialDiagnosisEnvironment>[0],
    'automationPaused'
  >;
  automationPaused: boolean;
  diagnose: () => Promise<CommercialOfficialDiagnosisReport>;
  persist?: (report: CommercialOfficialDiagnosisReport) => void;
}) => {
  assertCommercialOfficialDiagnosisArgs(args);
  assertCommercialOfficialDiagnosisEnvironment({
    ...environment,
    automationPaused,
  });
  const report = await diagnose();
  persist(report);
  return report;
};

const safeLogger = {
  info: (data: Record<string, unknown>) => console.log(JSON.stringify(data)),
  error: (data: Record<string, unknown>) => console.error(JSON.stringify(data)),
};

export const runCommercialOfficialDiagnosis = async (
  args: readonly string[] = process.argv.slice(2),
) => {
  assertCommercialOfficialDiagnosisArgs(args);
  assertOfficialDiagnosisPathIgnored();
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseDotEnv(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const mergedEnv = { ...fileEnv, ...process.env };
  const config = loadConfig(mergedEnv);
  assertCommercialOfficialDiagnosisStaticEnvironment({
    automationMode: config.COMMERCIAL_AUTOMATION_MODE,
    automationEnabled: config.COMMERCIAL_AUTOMATION_ENABLED,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
    groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
  });
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const prisma = createPrismaClient();
  try {
    const settings = await new PrismaCommercialAutomationSettingsRepository(
      prisma,
    ).get();
    const report = await executeCommercialOfficialDiagnosis({
      args,
      environment: {
        automationMode: config.COMMERCIAL_AUTOMATION_MODE,
        automationEnabled: config.COMMERCIAL_AUTOMATION_ENABLED,
        schedulerEnabled: config.SCHEDULER_ENABLED,
        commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
        groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      },
      automationPaused: settings?.paused === true,
      diagnose: () =>
        new CommercialOfficialDiagnosisService(
          new PrismaShopeeOfferRepository(prisma),
        ).diagnose(),
    });
    safeLogger.info({
      event: 'commercial-official.diagnosis.completed',
      report: {
        productCount: report.productCount,
        structuralEligibleCount: report.structuralEligibleCount,
        scoreMinimum: report.scoreMinimum,
        scoreMaximum: report.scoreMaximum,
        scoreAverage: report.scoreAverage,
        scoreMedian: report.scoreMedian,
        eligibleAt50: report.eligibleAt50,
        eligibleAt55: report.eligibleAt55,
        eligibleAt60: report.eligibleAt60,
        eligibleAt65: report.eligibleAt65,
        eligibleAt70: report.eligibleAt70,
        structuralRejectionSummary: report.structuralRejectionSummary,
        scorePolicyVersion: report.scorePolicyVersion,
      },
    });
    return report;
  } finally {
    await prisma.$disconnect();
  }
};

export const runCommercialOfficialDiagnosisMain = async (
  args: readonly string[],
  runner: (
    args: readonly string[],
  ) => Promise<unknown> = runCommercialOfficialDiagnosis,
) => {
  try {
    await runner(args);
    return 0;
  } catch (error) {
    safeLogger.error({
      event: 'commercial-official.diagnosis.failed',
      code:
        error instanceof AppError
          ? error.code
          : 'COMMERCIAL_OFFICIAL_DIAGNOSIS_FAILED',
      message:
        error instanceof AppError
          ? error.message
          : 'Falha segura no diagnostico oficial',
    });
    return 1;
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runCommercialOfficialDiagnosisMain(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
