import { describe, expect, it, vi } from 'vitest';

import { PrismaCommercialDispatchOutboxRepository } from '../src/prisma-repositories';
import type { CommercialConfirmationPersistenceInput } from '../src/repositories';

const confirmedAt = new Date('2026-07-28T12:00:00.000Z');
const input: CommercialConfirmationPersistenceInput = {
  outboxId: 'outbox-id',
  runId: 'run-id',
  confirmedAt,
  copy: {
    id: 'copy-id',
    productId: 'product-id',
    titulo: '',
    mensagem: 'preview seguro',
    cta: '',
    hashtags: '',
  },
  dispatch: {
    id: 'dispatch-id',
    productId: 'product-id',
    generatedCopyId: 'copy-id',
    destinationId: 'group-id',
  },
  jobId: 'job-id',
};

type Stage = 'claim' | 'copy' | 'dispatch' | 'outbox' | 'run';
type State = {
  run: {
    mode: 'DRY_RUN' | 'CONFIRMED';
    status: 'COMPLETED' | 'STARTED';
    dispatchId: string | null;
    jobId: string | null;
  };
  copies: string[];
  dispatches: string[];
  outboxes: string[];
};

const createTransactionalPrisma = (failure?: Stage) => {
  let state: State = {
    run: {
      mode: 'DRY_RUN',
      status: 'COMPLETED',
      dispatchId: null,
      jobId: null,
    },
    copies: [],
    dispatches: [],
    outboxes: [],
  };
  const fail = (stage: Stage) => {
    if (failure === stage) throw new Error(`failed:${stage}`);
  };
  const prisma = {
    async $transaction<T>(callback: (transaction: unknown) => Promise<T>) {
      const draft = structuredClone(state) as State;
      const transaction = {
        commercialPipelineRun: {
          updateMany: async () => {
            fail('claim');
            if (
              draft.run.mode !== 'DRY_RUN' ||
              draft.run.status !== 'COMPLETED'
            ) {
              return { count: 0 };
            }
            draft.run.mode = 'CONFIRMED';
            draft.run.status = 'STARTED';
            return { count: 1 };
          },
          update: async ({ data }: { data: { dispatchId: string } }) => {
            fail('run');
            draft.run.dispatchId = data.dispatchId;
            return draft.run;
          },
        },
        generatedCopy: {
          create: async ({ data }: { data: { id: string } }) => {
            fail('copy');
            draft.copies.push(data.id);
            return data;
          },
        },
        whatsAppDispatch: {
          create: async ({ data }: { data: { id: string } }) => {
            fail('dispatch');
            draft.dispatches.push(data.id);
            return data;
          },
        },
        commercialDispatchOutbox: {
          create: async ({ data }: { data: { id: string } }) => {
            fail('outbox');
            draft.outboxes.push(data.id);
            return {
              ...data,
              failureCode: null,
              createdAt: confirmedAt,
              publishedAt: null,
            };
          },
        },
      };
      const result = await callback(transaction);
      state = draft;
      return result;
    },
  };
  return { prisma, readState: () => state };
};

describe('PrismaCommercialDispatchOutboxRepository transaction', () => {
  it('commita copy, dispatch, run e outbox juntos', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaCommercialDispatchOutboxRepository(
      fake.prisma as never,
    );

    await expect(
      repository.createPendingConfirmation(input),
    ).resolves.toMatchObject({
      id: 'outbox-id',
      status: 'PENDING',
    });
    expect(fake.readState()).toEqual({
      run: {
        mode: 'CONFIRMED',
        status: 'STARTED',
        dispatchId: 'dispatch-id',
        jobId: null,
      },
      copies: ['copy-id'],
      dispatches: ['dispatch-id'],
      outboxes: ['outbox-id'],
    });
  });

  it.each(['claim', 'copy', 'dispatch', 'outbox', 'run'] as const)(
    'faz rollback integral quando falha na etapa %s',
    async (stage) => {
      const fake = createTransactionalPrisma(stage);
      const repository = new PrismaCommercialDispatchOutboxRepository(
        fake.prisma as never,
      );

      await expect(repository.createPendingConfirmation(input)).rejects.toThrow(
        `failed:${stage}`,
      );
      expect(fake.readState()).toEqual({
        run: {
          mode: 'DRY_RUN',
          status: 'COMPLETED',
          dispatchId: null,
          jobId: null,
        },
        copies: [],
        dispatches: [],
        outboxes: [],
      });
    },
  );

  it('mapeia colisao unica como inconsistencia, nao como confirmacao concorrente', async () => {
    const prisma = {
      $transaction: vi.fn(async () => {
        throw Object.assign(new Error('unique conflict'), { code: 'P2002' });
      }),
    };
    const repository = new PrismaCommercialDispatchOutboxRepository(
      prisma as never,
    );

    await expect(
      repository.createPendingConfirmation(input),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_OUTBOX_INCONSISTENT',
    });
  });

  it('promove PENDING com compare-and-set antes de associar o job ao run', async () => {
    const pending = {
      id: 'outbox-id',
      commercialRunId: 'run-id',
      dispatchId: 'dispatch-id',
      jobId: 'job-id',
      status: 'PENDING',
      failureCode: null,
      createdAt: confirmedAt,
      publishedAt: null,
    };
    const published = {
      ...pending,
      status: 'PUBLISHED',
      publishedAt: confirmedAt,
    };
    const outboxUpdateMany = vi.fn(async () => ({ count: 1 }));
    const runUpdateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(published);
    const transaction = {
      commercialDispatchOutbox: { findUnique, updateMany: outboxUpdateMany },
      commercialPipelineRun: { updateMany: runUpdateMany },
    };
    const repository = new PrismaCommercialDispatchOutboxRepository({
      $transaction: async (callback: (value: unknown) => Promise<unknown>) =>
        callback(transaction),
    } as never);

    await expect(
      repository.markPublished('outbox-id', confirmedAt),
    ).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    expect(outboxUpdateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-id', status: 'PENDING' },
      data: {
        status: 'PUBLISHED',
        failureCode: null,
        publishedAt: confirmedAt,
      },
    });
    expect(runUpdateMany).toHaveBeenCalledOnce();
  });

  it('preserva a primeira causa quando AMBIGUOUS ja e terminal', async () => {
    const ambiguous = {
      id: 'outbox-id',
      commercialRunId: 'run-id',
      dispatchId: 'dispatch-id',
      jobId: 'job-id',
      status: 'AMBIGUOUS',
      failureCode: 'FIRST_CAUSE',
      createdAt: confirmedAt,
      publishedAt: null,
    };
    const outboxUpdateMany = vi.fn();
    const runUpdate = vi.fn();
    const transaction = {
      commercialDispatchOutbox: {
        findUnique: vi.fn(async () => ambiguous),
        updateMany: outboxUpdateMany,
      },
      commercialPipelineRun: { update: runUpdate },
    };
    const repository = new PrismaCommercialDispatchOutboxRepository({
      $transaction: async (callback: (value: unknown) => Promise<unknown>) =>
        callback(transaction),
    } as never);

    await expect(
      repository.markAmbiguous('outbox-id', 'SECOND_CAUSE', confirmedAt),
    ).resolves.toMatchObject({ failureCode: 'FIRST_CAUSE' });
    expect(outboxUpdateMany).not.toHaveBeenCalled();
    expect(runUpdate).not.toHaveBeenCalled();
  });
});
