import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPLICATION_TABLES,
  BASELINE_MIGRATION,
  createBaselineRuntime,
  createPrismaClient,
  listRepositoryMigrations,
} from '@shopee-auto-affiliate-ai/database';

import type {
  PreviewExecutionEvidence,
  PreviewStabilityEvidence,
} from './preview-stability';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATIONS_DIRECTORY = resolve(
  ROOT,
  'packages/database/prisma/migrations',
);

const executionIsStale = (
  execution: {
    status: string;
    activeKey: string | null;
    ownerId: string | null;
    heartbeatAt: Date | null;
    leaseExpiresAt: Date | null;
  },
  now: Date,
) =>
  execution.status === 'STARTED' &&
  (!execution.activeKey ||
    !execution.ownerId ||
    !execution.heartbeatAt ||
    !execution.leaseExpiresAt ||
    execution.leaseExpiresAt.getTime() <= now.getTime());

const readExecutions = async (
  prisma: ReturnType<typeof createPrismaClient>,
  now: Date,
) => {
  const executions = await prisma.commercialAutomationExecution.findMany({
    select: {
      id: true,
      bullMqJobId: true,
      status: true,
      activeKey: true,
      ownerId: true,
      heartbeatAt: true,
      leaseExpiresAt: true,
    },
    orderBy: { startedAt: 'asc' },
  });
  return executions.map((execution): PreviewExecutionEvidence => ({
    id: execution.id,
    bullMqJobId: execution.bullMqJobId,
    status: execution.status,
    stale: executionIsStale(execution, now),
  }));
};

const readMigrations = async (
  environment: NodeJS.ProcessEnv,
): Promise<PreviewStabilityEvidence['migrations']> => {
  const repositoryMigrations = listRepositoryMigrations(MIGRATIONS_DIRECTORY);
  const runtime = createBaselineRuntime({ root: ROOT, environment });
  try {
    const inspection = await runtime.inspect();
    const applied = inspection.migrationRows.filter(
      (migration) => migration.finishedAt && !migration.rolledBackAt,
    );
    const appliedNames = new Set(
      applied.map((migration) => migration.migrationName),
    );
    return {
      applied: applied.length,
      failed: inspection.migrationRows.filter(
        (migration) => !migration.finishedAt && !migration.rolledBackAt,
      ).length,
      pending: repositoryMigrations.filter((name) => !appliedNames.has(name))
        .length,
      unexpected: applied.filter(
        (migration) => !repositoryMigrations.includes(migration.migrationName),
      ).length,
      baselineRegistered: appliedNames.has(BASELINE_MIGRATION),
      schemaMatchesCurrent:
        inspection.schemaMatchesCurrent &&
        inspection.missingBaselineObjects.length === 0,
    };
  } finally {
    await runtime.close();
  }
};

const countTables = async (prisma: ReturnType<typeof createPrismaClient>) => {
  const entries = await Promise.all(
    APPLICATION_TABLES.map(async (table) => {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM "${table}"`,
      );
      return [table, Number(rows[0]?.count ?? 0)] as const;
    }),
  );
  return Object.fromEntries(entries);
};

const captureDatabaseEvidence = async (
  environment: NodeJS.ProcessEnv,
): Promise<Omit<PreviewStabilityEvidence, 'queues'>> => {
  const prisma = createPrismaClient();
  try {
    const [
      migrations,
      settings,
      executions,
      totalRuns,
      dryRuns,
      ambiguousRuns,
      investigationRuns,
      dispatchTotal,
      processingDispatches,
      outboxTotal,
      pendingOutboxes,
      ambiguousOutboxes,
      tableCounts,
    ] = await Promise.all([
      readMigrations(environment),
      prisma.commercialAutomationSettings.findUnique({
        where: { id: 'commercial-automation' },
        select: { paused: true },
      }),
      readExecutions(prisma, new Date()),
      prisma.commercialPipelineRun.count(),
      prisma.commercialPipelineRun.count({ where: { mode: 'DRY_RUN' } }),
      prisma.commercialPipelineRun.count({
        where: { finalStatus: 'AMBIGUOUS' },
      }),
      prisma.commercialPipelineRun.count({
        where: { investigationRequired: true },
      }),
      prisma.whatsAppDispatch.count(),
      prisma.whatsAppDispatch.count({ where: { status: 'PROCESSING' } }),
      prisma.commercialDispatchOutbox.count(),
      prisma.commercialDispatchOutbox.count({ where: { status: 'PENDING' } }),
      prisma.commercialDispatchOutbox.count({
        where: { status: 'AMBIGUOUS' },
      }),
      countTables(prisma),
    ]);
    return {
      migrations,
      settings: {
        present: Boolean(settings),
        paused: settings?.paused ?? false,
      },
      executions,
      runs: {
        total: totalRuns,
        dryRun: dryRuns,
        ambiguous: ambiguousRuns,
        investigationRequired: investigationRuns,
      },
      dispatches: { total: dispatchTotal, processing: processingDispatches },
      outboxes: {
        total: outboxTotal,
        pending: pendingOutboxes,
        ambiguous: ambiguousOutboxes,
      },
      tableCounts,
    };
  } finally {
    await prisma.$disconnect();
  }
};

const run = async () => {
  const command = process.argv[2];
  if (command === 'capture') return captureDatabaseEvidence(process.env);

  const prisma = createPrismaClient();
  try {
    if (command === 'executions') return readExecutions(prisma, new Date());
    if (command === 'group-instance') {
      const groups = await prisma.whatsAppDestination.findMany({
        where: { type: 'GROUP', active: true, available: true },
        select: { sourceInstanceName: true, fingerprint: true },
      });
      const eligible = groups.filter(
        (group) =>
          Boolean(group.sourceInstanceName) &&
          /^grp_[a-f0-9]{12}$/.test(group.fingerprint ?? ''),
      );
      if (eligible.length !== 1 || !eligible[0].sourceInstanceName) {
        throw new Error('preview group instance is not unique');
      }
      return { instanceName: eligible[0].sourceInstanceName };
    }
    if (command === 'force-pause') {
      await prisma.commercialAutomationSettings.update({
        where: { id: 'commercial-automation' },
        data: { paused: true, pausedAt: new Date() },
      });
      return { paused: true };
    }
    throw new Error('invalid database helper command');
  } finally {
    await prisma.$disconnect();
  }
};

void run()
  .then((result) => console.log(JSON.stringify(result)))
  .catch(() => {
    console.error(
      JSON.stringify({ code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED' }),
    );
    process.exitCode = 1;
  });
