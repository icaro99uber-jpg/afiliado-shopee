import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DatabaseBaselineError,
  adoptBaseline,
  createBaselineRuntime,
  evaluateBaselineStatus,
  listRepositoryMigrations,
  loadDatabaseEnvironment,
  parseBaselineArgs,
  type BaselineRuntime,
} from './migration-baseline';

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

export const runMigrationBaselineCli = async ({
  args = process.argv.slice(2),
  environment = process.env,
  root = ROOT,
  migrationsDirectory = MIGRATIONS_DIRECTORY,
  logger = consoleLogger,
  runtimeFactory = createBaselineRuntime,
}: {
  args?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  root?: string;
  migrationsDirectory?: string;
  logger?: SafeLogger;
  runtimeFactory?: (options: {
    root: string;
    environment: NodeJS.ProcessEnv;
  }) => BaselineRuntime;
} = {}) => {
  let runtime: BaselineRuntime | undefined;
  let outcome:
    { exitCode: number; result: Record<string, unknown> } | undefined;
  try {
    const command = parseBaselineArgs(args);
    const loadedEnvironment = loadDatabaseEnvironment(root, environment);
    const migrations = listRepositoryMigrations(migrationsDirectory);
    runtime = runtimeFactory({ root, environment: loadedEnvironment });
    if (command.command === 'status') {
      const result = evaluateBaselineStatus(
        migrations,
        await runtime.inspect(),
      );
      logger.info({ event: 'database-baseline.status.completed', result });
      outcome = { exitCode: 0, result };
    } else {
      const result = await adoptBaseline(migrations, runtime);
      logger.info({ event: 'database-baseline.adopt.completed', result });
      outcome = { exitCode: 0, result };
    }
  } catch (error) {
    const result = {
      code:
        error instanceof DatabaseBaselineError
          ? error.code
          : 'DATABASE_BASELINE_OPERATION_FAILED',
      message:
        error instanceof DatabaseBaselineError
          ? error.message
          : 'Operacao da baseline falhou com seguranca',
    };
    logger.error({ event: 'database-baseline.operation.failed', ...result });
    outcome = { exitCode: 1, result };
  }
  try {
    await runtime?.close();
  } catch {
    const result = {
      code: 'DATABASE_BASELINE_CLOSE_FAILED',
      message: 'Conexao da baseline nao encerrou corretamente',
    };
    logger.error({ event: 'database-baseline.close.failed', ...result });
    return { exitCode: 1, result };
  }
  return outcome!;
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runMigrationBaselineCli().then(({ exitCode }) => {
    process.exitCode = exitCode;
  });
}
