import { PrismaClient } from '@prisma/client';
export const createPrismaClient = () => new PrismaClient();
export type DatabaseClient = ReturnType<typeof createPrismaClient>;
