import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  OfficialShopeeAffiliateOfferProvider,
  SHOPEE_AFFILIATE_REAL_READ_LIMIT,
  type OfficialShopeeAffiliateFetch,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { PrismaShopeeOfferRepository } from './prisma-repositories';
import {
  createShopeeOfficialPreflightRuntime,
  executeShopeeOfficialPreflight,
  loadShopeeOfficialConfig,
} from './shopee-official-preflight';
import {
  ShopeeOfferSyncService,
  type ShopeeOfferSyncReport,
} from './shopee-offer-sync-service';

const CONFIRM_FLAG = '--confirm-one-real-read';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STATE_DIRECTORY = join(
  REPOSITORY_ROOT,
  '.runtime',
  'shopee-official-contract',
);
const STATE_PATH = join(STATE_DIRECTORY, 'real-read-state.json');
const CONTRACT_EVIDENCE_PATH = join(
  STATE_DIRECTORY,
  'real-response-contract.sanitized.json',
);

type ProtectedCounts = {
  commercialPipelineRuns: number;
  commercialAutomationExecutions: number;
  whatsappDispatches: number;
  commercialDispatchOutboxes: number;
};

export type SanitizedShopeeOfficialSyncReport = Pick<
  ShopeeOfferSyncReport,
  | 'fetched'
  | 'valid'
  | 'created'
  | 'updated'
  | 'rejected'
  | 'expired'
  | 'hasNextPage'
  | 'affiliateLinkPresentCount'
> & {
  realRequests: 1;
  maximumProducts: 5;
};

export type ShopeeOfficialSyncRuntime = {
  preflight(): Promise<void>;
  protectedCounts(): Promise<ProtectedCounts>;
  sync(): Promise<ShopeeOfferSyncReport>;
  close(): Promise<void>;
};

const blocked = (code: string, message: string) => new AppError(message, code);

export const parseShopeeOfficialSyncArgs = (args: readonly string[]) => {
  const separators = args.filter((argument) => argument === '--').length;
  const normalized = args.filter((argument) => argument !== '--');
  if (
    separators > 1 ||
    normalized.length !== 1 ||
    normalized[0] !== CONFIRM_FLAG
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_CONFIRMATION_REQUIRED',
      `A flag exata ${CONFIRM_FLAG} e obrigatoria`,
    );
  }
};

const writeAtomicState = (path: string, value: Record<string, unknown>) => {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
};

const assertStateDirectoryIgnored = () => {
  const result = spawnSync(
    'git',
    [
      'check-ignore',
      '--quiet',
      '.runtime/shopee-official-contract/real-read-state.json',
    ],
    { cwd: REPOSITORY_ROOT, stdio: 'ignore', windowsHide: true },
  );
  if (result.status !== 0) {
    throw blocked(
      'SHOPEE_OFFICIAL_RUNTIME_NOT_IGNORED',
      'Diretorio de evidencia local nao esta ignorado pelo Git',
    );
  }
};

export const createSingleOfficialReadFetch = ({
  fetchImplementation = fetch,
  statePath = STATE_PATH,
  now = () => new Date(),
}: {
  fetchImplementation?: OfficialShopeeAffiliateFetch;
  statePath?: string;
  now?: () => Date;
} = {}): OfficialShopeeAffiliateFetch => {
  let calls = 0;
  return (async (input, init) => {
    calls += 1;
    if (calls !== 1) {
      throw blocked(
        'SHOPEE_OFFICIAL_MULTIPLE_READS_BLOCKED',
        'Mais de uma consulta oficial foi bloqueada',
      );
    }
    assertStateDirectoryIgnored();
    mkdirSync(dirname(statePath), { recursive: true });
    let descriptor: number;
    try {
      descriptor = openSync(statePath, 'wx', 0o600);
    } catch {
      throw blocked(
        'SHOPEE_OFFICIAL_REAL_READ_ALREADY_CLAIMED',
        'A consulta real desta task ja foi iniciada',
      );
    }
    try {
      writeFileSync(
        descriptor,
        `${JSON.stringify({
          status: 'REQUEST_STARTED',
          startedAt: now().toISOString(),
          maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
        })}\n`,
        'utf8',
      );
    } finally {
      closeSync(descriptor);
    }
    try {
      const response = await fetchImplementation(input, init);
      writeAtomicState(statePath, {
        status: 'RESPONSE_RECEIVED',
        receivedAt: now().toISOString(),
        httpStatus: response.status,
        maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
      });
      return response;
    } catch (error) {
      writeAtomicState(statePath, {
        status: 'REQUEST_OUTCOME_UNKNOWN',
        failedAt: now().toISOString(),
        maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
      });
      throw error;
    }
  }) as OfficialShopeeAffiliateFetch;
};

const protectedCountsEqual = (
  before: ProtectedCounts,
  after: ProtectedCounts,
) =>
  (Object.keys(before) as (keyof ProtectedCounts)[]).every(
    (key) => before[key] === after[key],
  );

export const executeShopeeOfficialSync = async ({
  args,
  env,
  runtime,
}: {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  runtime: ShopeeOfficialSyncRuntime;
}): Promise<SanitizedShopeeOfficialSyncReport> => {
  if (env.CI) {
    throw blocked(
      'SHOPEE_OFFICIAL_CI_BLOCKED',
      'Consulta oficial bloqueada em CI',
    );
  }
  parseShopeeOfficialSyncArgs(args);
  await runtime.preflight();
  const before = await runtime.protectedCounts();
  const report = await runtime.sync();
  const after = await runtime.protectedCounts();
  if (!protectedCountsEqual(before, after)) {
    throw blocked(
      'SHOPEE_OFFICIAL_FORBIDDEN_SIDE_EFFECT',
      'A consulta alterou estado comercial proibido',
    );
  }
  if (
    report.fetched > SHOPEE_AFFILIATE_REAL_READ_LIMIT ||
    report.valid > SHOPEE_AFFILIATE_REAL_READ_LIMIT ||
    report.created + report.updated > SHOPEE_AFFILIATE_REAL_READ_LIMIT
  ) {
    throw blocked(
      'SHOPEE_OFFICIAL_LIMIT_EXCEEDED',
      'A consulta excedeu o limite controlado',
    );
  }
  return {
    fetched: report.fetched,
    valid: report.valid,
    created: report.created,
    updated: report.updated,
    rejected: report.rejected,
    expired: report.expired,
    hasNextPage: report.hasNextPage,
    affiliateLinkPresentCount: report.affiliateLinkPresentCount,
    realRequests: 1,
    maximumProducts: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
  };
};

export const createShopeeOfficialSyncRuntime = (
  config: AppEnv,
): ShopeeOfficialSyncRuntime => {
  const prisma = createPrismaClient();
  const preflightRuntime = createShopeeOfficialPreflightRuntime(config);
  const provider = new OfficialShopeeAffiliateOfferProvider({
    apiEnabled: config.SHOPEE_AFFILIATE_API_ENABLED,
    apiUrl: config.SHOPEE_AFFILIATE_API_URL,
    appId: config.SHOPEE_AFFILIATE_APP_ID,
    secret: config.SHOPEE_AFFILIATE_SECRET,
    fetch: createSingleOfficialReadFetch(),
    onObservedContract: (contract) =>
      writeAtomicState(CONTRACT_EVIDENCE_PATH, {
        observedAt: new Date().toISOString(),
        ...contract,
      }),
  });
  const sync = new ShopeeOfferSyncService({
    provider,
    offers: new PrismaShopeeOfferRepository(prisma),
    maxOffersPerSync: SHOPEE_AFFILIATE_REAL_READ_LIMIT,
    logger: {
      info: () => undefined,
      error: () => undefined,
    },
  });
  return {
    async preflight() {
      await executeShopeeOfficialPreflight({
        config,
        runtime: preflightRuntime,
      });
    },
    async protectedCounts() {
      const [
        commercialPipelineRuns,
        commercialAutomationExecutions,
        whatsappDispatches,
        commercialDispatchOutboxes,
      ] = await prisma.$transaction([
        prisma.commercialPipelineRun.count(),
        prisma.commercialAutomationExecution.count(),
        prisma.whatsAppDispatch.count(),
        prisma.commercialDispatchOutbox.count(),
      ]);
      return {
        commercialPipelineRuns,
        commercialAutomationExecutions,
        whatsappDispatches,
        commercialDispatchOutboxes,
      };
    },
    async sync() {
      return sync.run({ limit: SHOPEE_AFFILIATE_REAL_READ_LIMIT, page: 1 });
    },
    async close() {
      await Promise.allSettled([
        preflightRuntime.close(),
        prisma.$disconnect(),
      ]);
    },
  };
};

export const runShopeeOfficialSync = async ({
  args = process.argv.slice(2),
  env = process.env,
  runtimeFactory = createShopeeOfficialSyncRuntime,
}: {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  runtimeFactory?: (config: AppEnv) => ShopeeOfficialSyncRuntime;
} = {}) => {
  if (env.CI) {
    throw blocked(
      'SHOPEE_OFFICIAL_CI_BLOCKED',
      'Consulta oficial bloqueada em CI',
    );
  }
  parseShopeeOfficialSyncArgs(args);
  const config = loadShopeeOfficialConfig(env);
  process.env.DATABASE_URL ??= config.DATABASE_URL;
  const runtime = runtimeFactory(config);
  try {
    return await executeShopeeOfficialSync({ args, env, runtime });
  } finally {
    await runtime.close();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  runShopeeOfficialSync()
    .then((result) => {
      writeAtomicState(STATE_PATH, {
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        ...result,
      });
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          completed: false,
          code:
            error instanceof AppError
              ? error.code
              : 'SHOPEE_OFFICIAL_SYNC_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
