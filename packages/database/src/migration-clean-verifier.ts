import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

import {
  DatabaseBaselineError,
  listRepositoryMigrations,
  loadDatabaseEnvironment,
  runPrismaCommand,
  runSanitizedCommand,
} from './migration-baseline';

export const CLEAN_DATABASE_PREFIX = 'shopee_migration_verify_';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATIONS_DIRECTORY = resolve(
  ROOT,
  'packages/database/prisma/migrations',
);

type SafeLogger = {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
};

const consoleLogger: SafeLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

export const assertTemporaryDatabaseName = (databaseName: string) => {
  if (
    !new RegExp(`^${CLEAN_DATABASE_PREFIX}[0-9a-f]{32}$`).test(databaseName)
  ) {
    throw new DatabaseBaselineError(
      'Nome do banco temporario fora do prefixo permitido',
      'CLEAN_DATABASE_NAME_REJECTED',
    );
  }
};

export const parseCleanVerificationArgs = (args: readonly string[]) => {
  const normalized = args.filter((argument) => argument !== '--');
  const separators = args.length - normalized.length;
  if (normalized.length !== 0 || separators > 1) {
    throw new DatabaseBaselineError(
      'db:migrations:verify-clean nao aceita argumentos',
      'CLEAN_DATABASE_ARGUMENTS_INVALID',
    );
  }
};

const databaseUrls = (configuredUrl: string, databaseName: string) => {
  assertTemporaryDatabaseName(databaseName);
  const admin = new URL(configuredUrl);
  admin.pathname = '/postgres';
  admin.searchParams.delete('schema');
  const temporary = new URL(configuredUrl);
  temporary.pathname = `/${databaseName}`;
  temporary.searchParams.delete('schema');
  return { adminUrl: admin.toString(), temporaryUrl: temporary.toString() };
};

type DatabaseClient = {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  $disconnect(): Promise<void>;
};

type DatabaseClientFactory = (databaseUrl: string) => DatabaseClient;

const createDatabaseClient: DatabaseClientFactory = (databaseUrl) =>
  new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  }) as DatabaseClient;

export const dropTemporaryDatabase = async (
  admin: DatabaseClient,
  databaseName: string,
) => {
  assertTemporaryDatabaseName(databaseName);
  await admin.$queryRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    databaseName,
  );
  await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
};

export const runCleanMigrationVerification = async ({
  args = process.argv.slice(2),
  environment = process.env,
  root = ROOT,
  migrationsDirectory = MIGRATIONS_DIRECTORY,
  logger = consoleLogger,
  databaseNameFactory = () =>
    `${CLEAN_DATABASE_PREFIX}${randomUUID().replaceAll('-', '')}`,
  clientFactory = createDatabaseClient,
  commandRunner = runSanitizedCommand,
}: {
  args?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  root?: string;
  migrationsDirectory?: string;
  logger?: SafeLogger;
  databaseNameFactory?: () => string;
  clientFactory?: DatabaseClientFactory;
  commandRunner?: typeof runSanitizedCommand;
} = {}) => {
  let admin: DatabaseClient | undefined;
  let temporary: DatabaseClient | undefined;
  let databaseName: string | undefined;
  let created = false;
  let cleanedUp = false;
  let stage = 'initialization';
  try {
    stage = 'arguments';
    parseCleanVerificationArgs(args);
    stage = 'environment';
    const loadedEnvironment = loadDatabaseEnvironment(root, environment);
    databaseName = databaseNameFactory();
    assertTemporaryDatabaseName(databaseName);
    const urls = databaseUrls(loadedEnvironment.DATABASE_URL, databaseName);
    stage = 'create-database';
    admin = clientFactory(urls.adminUrl);
    await admin.$executeRawUnsafe(
      `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
    );
    created = true;
    stage = 'verify-empty';
    temporary = clientFactory(urls.temporaryUrl);
    const initialObjects = await temporary.$queryRawUnsafe<
      Array<{ count: bigint }>
    >(`
      SELECT (
        SELECT COUNT(*) FROM pg_class cls
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = 'public'
          AND cls.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ) + (
        SELECT COUNT(*) FROM pg_type typ
        JOIN pg_namespace ns ON ns.oid = typ.typnamespace
        WHERE ns.nspname = 'public'
          AND typ.typrelid = 0
          AND typ.typtype IN ('d', 'e')
      ) AS count
    `);
    if (Number(initialObjects[0]?.count ?? 0) !== 0) {
      throw new DatabaseBaselineError(
        'Banco temporario nao iniciou vazio',
        'CLEAN_DATABASE_NOT_EMPTY',
      );
    }

    const temporaryEnvironment = {
      ...loadedEnvironment,
      DATABASE_URL: urls.temporaryUrl,
    };
    stage = 'migrate-deploy';
    const deploy = await runPrismaCommand(
      ['migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      { root, environment: temporaryEnvironment },
      commandRunner,
    );
    if (deploy.code !== 0) {
      throw new DatabaseBaselineError(
        'migrate deploy falhou no banco temporario',
        'CLEAN_DATABASE_DEPLOY_FAILED',
      );
    }
    stage = 'migrate-status';
    const status = await runPrismaCommand(
      ['migrate', 'status', '--schema', 'prisma/schema.prisma'],
      { root, environment: temporaryEnvironment },
      commandRunner,
    );
    if (status.code !== 0) {
      throw new DatabaseBaselineError(
        'migrate status falhou no banco temporario',
        'CLEAN_DATABASE_STATUS_FAILED',
      );
    }
    stage = 'schema-diff';
    const drift = await runPrismaCommand(
      [
        'migrate',
        'diff',
        '--from-schema-datasource',
        'prisma/schema.prisma',
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { root, environment: temporaryEnvironment },
      commandRunner,
    );
    if (drift.code !== 0) {
      throw new DatabaseBaselineError(
        'Schema do banco temporario possui drift',
        'CLEAN_DATABASE_DRIFT_DETECTED',
      );
    }
    stage = 'history-check';
    const migrationRows = await temporary.$queryRawUnsafe<
      Array<{
        migrationName: string;
        finishedAt: Date | null;
        rolledBackAt: Date | null;
      }>
    >(`
      SELECT migration_name AS "migrationName", finished_at AS "finishedAt",
             rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `);
    const repositoryMigrations = listRepositoryMigrations(migrationsDirectory);
    const applied = migrationRows
      .filter((migration) => migration.finishedAt && !migration.rolledBackAt)
      .map((migration) => migration.migrationName)
      .sort();
    if (JSON.stringify(applied) !== JSON.stringify(repositoryMigrations)) {
      throw new DatabaseBaselineError(
        'Historico aplicado diverge do repositorio',
        'CLEAN_DATABASE_HISTORY_MISMATCH',
      );
    }
    stage = 'cleanup';
    await temporary.$disconnect();
    temporary = undefined;
    await dropTemporaryDatabase(admin, databaseName);
    cleanedUp = true;
    const result = {
      temporaryDatabaseCreated: true,
      startedEmpty: true,
      migrationsApplied: applied.length,
      schemaMatches: true,
      drift: false,
      cleanedUp,
    };
    logger.info({
      event: 'database-migrations.verify-clean.completed',
      result,
    });
    return { exitCode: 0, result };
  } catch (error) {
    const result = {
      code:
        error instanceof DatabaseBaselineError
          ? error.code
          : `CLEAN_DATABASE_${stage.toUpperCase().replaceAll('-', '_')}_FAILED`,
      message:
        error instanceof DatabaseBaselineError
          ? error.message
          : 'Verificacao de migrations falhou com seguranca',
    };
    logger.error({
      event: 'database-migrations.verify-clean.failed',
      ...result,
    });
    return { exitCode: 1, result };
  } finally {
    await temporary?.$disconnect().catch(() => undefined);
    if (created && !cleanedUp && admin && databaseName) {
      try {
        await dropTemporaryDatabase(admin, databaseName);
      } catch {
        logger.error({
          event: 'database-migrations.verify-clean.cleanup-failed',
          code: 'CLEAN_DATABASE_CLEANUP_FAILED',
        });
      }
    }
    await admin?.$disconnect().catch(() => undefined);
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runCleanMigrationVerification().then(({ exitCode }) => {
    process.exitCode = exitCode;
  });
}
