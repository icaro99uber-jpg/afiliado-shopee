import { describe, expect, it, vi } from 'vitest';

import {
  PrismaWhatsAppDestinationRepository,
  PrismaWhatsAppGroupDirectoryRepository,
} from '../src/prisma-repositories';

describe('separacao entre destinos individuais e grupos', () => {
  it('pipeline consulta somente destinos individuais ativos', async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaWhatsAppDestinationRepository({
      whatsAppDestination: { findMany },
    } as never);
    await repository.listActive();
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, type: 'INDIVIDUAL' },
    });
  });

  it('diretorio consulta somente grupos da instancia atual', async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaWhatsAppGroupDirectoryRepository({
      whatsAppDestination: { findMany },
    } as never);
    await repository.list('test-instance', { active: true, available: true });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'GROUP',
        sourceInstanceName: 'test-instance',
        active: true,
        available: true,
      },
      orderBy: { name: 'asc' },
    });
  });
});
