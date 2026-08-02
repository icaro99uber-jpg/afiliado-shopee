import { describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../src/index';

const mockPrismaClientConstructor = vi.fn();

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor(options?: any) {
        mockPrismaClientConstructor(options);
      }
    }
  };
});

describe('createPrismaClient', () => {
  it('SEM URL cria sem override de datasource', () => {
    mockPrismaClientConstructor.mockClear();
    createPrismaClient();
    expect(mockPrismaClientConstructor).toHaveBeenCalledWith(undefined);
  });

  it('COM URL cria com override de datasource explícito', () => {
    mockPrismaClientConstructor.mockClear();
    createPrismaClient('postgresql://localhost:5432/app');
    expect(mockPrismaClientConstructor).toHaveBeenCalledWith({
      datasources: {
        db: {
          url: 'postgresql://localhost:5432/app'
        }
      }
    });
  });
});
