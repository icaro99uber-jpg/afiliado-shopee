import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID } from '@shopee-auto-affiliate-ai/queue';

import {
  commercialAutomationConsoleLogger,
  createCommercialAutomationOrchestratorRuntime,
} from './commercial-automation-runtime';
import { parseLocalDotEnv } from './local-env';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

export const loadCommercialAutomationPreviewConfig = (
  env: NodeJS.ProcessEnv,
) =>
  loadConfig({
    ...env,
    COMMERCIAL_AUTOMATION_MODE: 'preview',
  });

const safePreviewFailureCode = (error: unknown) => {
  if (error instanceof AppError) return error.code;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code)
  ) {
    return error.code;
  }
  return 'COMMERCIAL_AUTOMATION_PREVIEW_FAILED';
};

const safeInvalidFields = (error: unknown) => {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('issues' in error) ||
    !Array.isArray(error.issues)
  ) {
    return undefined;
  }
  return error.issues
    .map((issue) =>
      typeof issue === 'object' &&
      issue !== null &&
      'path' in issue &&
      Array.isArray(issue.path)
        ? issue.path.map(String).join('.')
        : null,
    )
    .filter((field): field is string => Boolean(field));
};

export const runCommercialAutomationPreview = async (
  args: readonly string[] = [],
) => {
  if (args.length > 0) {
    throw new AppError(
      'O preview da automacao comercial nao aceita argumentos',
      'COMMERCIAL_AUTOMATION_PREVIEW_ARGUMENTS_INVALID',
    );
  }
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseLocalDotEnv(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  const config = loadCommercialAutomationPreviewConfig({
    ...fileEnv,
    ...process.env,
  });
  if (config.COMMERCIAL_SCHEDULER_ENABLED) {
    throw new AppError(
      'Scheduler comercial deve estar desligado para o preview manual',
      'COMMERCIAL_AUTOMATION_SCHEDULER_MUST_BE_DISABLED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new AppError(
      'Scheduler legado deve permanecer desligado',
      'LEGACY_SCHEDULER_MUST_BE_DISABLED',
    );
  }
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const runtime = createCommercialAutomationOrchestratorRuntime(config);
  try {
    const result = await runtime.orchestrator.executeTick({
      schedulerJobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      mode: 'preview',
      provider: config.SHOPEE_AFFILIATE_PROVIDER,
    });
    commercialAutomationConsoleLogger.info(
      {
        event: 'commercial-automation.preview.completed',
        result,
      },
      'Commercial automation preview completed',
    );
    return result;
  } finally {
    if (runtime.ownsPrisma) await runtime.prisma.$disconnect();
  }
};

export const runCommercialAutomationPreviewMain = async (
  args: readonly string[],
  runner: (
    args: readonly string[],
  ) => Promise<unknown> = runCommercialAutomationPreview,
) => {
  try {
    await runner(args);
    return 0;
  } catch (error) {
    commercialAutomationConsoleLogger.error(
      {
        event: 'commercial-automation.preview.failed',
        code: safePreviewFailureCode(error),
        errorType: error instanceof Error ? error.name : typeof error,
        invalidFields: safeInvalidFields(error),
      },
      'Commercial automation preview failed',
    );
    return 1;
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runCommercialAutomationPreviewMain(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
