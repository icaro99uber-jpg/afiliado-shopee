import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseDotEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  normalizeCommercialAiCopyModel,
  sanitizeCommercialAiCopyProviderErrorMetadata,
} from './commercial-ai-copy-provider';
import { PrismaCommercialPromotionCopyRepository } from './prisma-repositories';
import type { CommercialCopyGenerationAttemptStatusRecord } from './repositories';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const INTERNAL_ID = /^[A-Za-z0-9_-]{1,100}$/u;
const SAFE_VALUE = /^[A-Za-z0-9._-]{1,100}$/u;
const SAFE_PUBLIC_CODE = /^[A-Z0-9_]{1,100}$/u;

const cliError = (code: string): never => {
  throw new AppError('Consulta de attempts invalida', code);
};

const normalizeArgs = (args: readonly string[]) =>
  args[0] === '--' ? args.slice(1) : [...args];

const parseCandidateId = (value: string | undefined): string => {
  const candidateId = value?.trim();
  if (!candidateId || !INTERNAL_ID.test(candidateId)) {
    cliError('COMMERCIAL_AI_COPY_ATTEMPT_CANDIDATE_ID_INVALID');
  }
  return candidateId as string;
};

export const parseCommercialCopyAttemptStatusCliArgs = (
  rawArgs: readonly string[],
) => {
  const args = normalizeArgs(rawArgs);
  const candidates = args.filter((argument) =>
    argument.startsWith('--candidate-id='),
  );
  if (
    candidates.length !== 1 ||
    args.length !== 1 ||
    args.some((argument) => !argument.startsWith('--candidate-id='))
  ) {
    cliError('COMMERCIAL_AI_COPY_ATTEMPT_CLI_ARGUMENTS_INVALID');
  }
  return { candidateId: parseCandidateId(candidates[0]?.slice(15)) } as const;
};

const safeIdentifier = (value: string) =>
  INTERNAL_ID.test(value) ? value : '[REMOVIDO]';

const safeValue = (value: string | null) =>
  value && SAFE_VALUE.test(value) ? value : null;

const safePublicCode = (value: string | null) =>
  value && SAFE_PUBLIC_CODE.test(value) ? value : null;

const safeDate = (value: Date | null) =>
  value && !Number.isNaN(value.getTime()) ? value.toISOString() : null;

export type SanitizedCommercialCopyAttemptStatus = {
  attemptId: string;
  candidateId: string;
  status: CommercialCopyGenerationAttemptStatusRecord['status'];
  failureCode: string | null;
  requestMayHaveStarted: boolean;
  provider: string | null;
  model: string;
  promptVersion: string | null;
  validationVersion: string | null;
  providerHttpStatus: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  providerErrorParam: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

const sanitizeAttempt = (
  attempt: CommercialCopyGenerationAttemptStatusRecord,
): SanitizedCommercialCopyAttemptStatus => {
  const metadata = sanitizeCommercialAiCopyProviderErrorMetadata({
    httpStatus: attempt.providerHttpStatus ?? undefined,
    providerErrorCode: attempt.providerErrorCode ?? undefined,
    providerErrorType: attempt.providerErrorType ?? undefined,
    providerErrorParam: attempt.providerErrorParam ?? undefined,
  });
  return {
    attemptId: safeIdentifier(attempt.id),
    candidateId: safeIdentifier(attempt.candidateId),
    status: attempt.status,
    failureCode: safePublicCode(attempt.failureCode),
    requestMayHaveStarted: attempt.requestMayHaveStarted,
    provider: safeValue(attempt.provider)?.toLocaleLowerCase('en-US') ?? null,
    model: normalizeCommercialAiCopyModel(attempt.model),
    promptVersion: safeValue(attempt.promptVersion),
    validationVersion: safeValue(attempt.validationVersion),
    providerHttpStatus: metadata.httpStatus ?? null,
    providerErrorCode: metadata.providerErrorCode ?? null,
    providerErrorType: metadata.providerErrorType ?? null,
    providerErrorParam: metadata.providerErrorParam ?? null,
    startedAt: safeDate(attempt.startedAt),
    completedAt: safeDate(attempt.completedAt),
  };
};

type AttemptStatusRepository = Pick<
  PrismaCommercialPromotionCopyRepository,
  'listAttemptsByCandidateId'
>;

export const executeCommercialCopyAttemptStatusCli = async ({
  args,
  repository,
}: {
  args: readonly string[];
  repository: AttemptStatusRepository;
}) => {
  const { candidateId } = parseCommercialCopyAttemptStatusCliArgs(args);
  const attempts = await repository.listAttemptsByCandidateId(candidateId);
  return [...attempts]
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    )
    .map(sanitizeAttempt);
};

export const runCommercialCopyAttemptStatusCli = async (
  rawArgs: readonly string[] = process.argv.slice(2),
) => {
  const fileEnv = existsSync(ROOT_ENV_PATH)
    ? parseDotEnv(readFileSync(ROOT_ENV_PATH, 'utf8'))
    : {};
  if (fileEnv.DATABASE_URL && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = fileEnv.DATABASE_URL;
  }
  const prisma = createPrismaClient();
  try {
    return await executeCommercialCopyAttemptStatusCli({
      args: rawArgs,
      repository: new PrismaCommercialPromotionCopyRepository(prisma),
    });
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runCommercialCopyAttemptStatusCli()
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          completed: false,
          code:
            error instanceof AppError
              ? error.code
              : 'COMMERCIAL_AI_COPY_ATTEMPT_CLI_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
