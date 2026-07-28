import { PrismaClient } from '@prisma/client';
export const createPrismaClient = () => new PrismaClient();
export type DatabaseClient = ReturnType<typeof createPrismaClient>;

export {
  APPLICATION_TABLES,
  BASELINE_MIGRATION,
  createBaselineRuntime,
  listRepositoryMigrations,
} from './migration-baseline.js';
