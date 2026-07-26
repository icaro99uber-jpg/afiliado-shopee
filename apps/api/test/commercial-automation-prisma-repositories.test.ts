import { describe, expect, it, vi } from 'vitest';

import {
  PrismaCommercialAutomationHistoryRepository,
  PrismaCommercialAutomationSettingsRepository,
} from '../src/prisma-repositories';

describe('commercial automation Prisma repositories', () => {
  it('inicializa o singleton pausado e persiste pausa/retomada', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({
        paused: true,
        pausedAt: new Date('2026-07-25T15:00:00.000Z'),
        resumedAt: null,
        updatedAt: new Date('2026-07-25T15:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        paused: true,
        pausedAt: new Date('2026-07-25T15:00:00.000Z'),
        resumedAt: null,
        updatedAt: new Date('2026-07-25T15:00:00.000Z'),
      });
    const update = vi.fn().mockResolvedValueOnce({
      paused: false,
      pausedAt: new Date('2026-07-25T15:00:00.000Z'),
      resumedAt: new Date('2026-07-25T16:00:00.000Z'),
      updatedAt: new Date('2026-07-25T16:00:00.000Z'),
    });
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: { upsert, update },
    } as never);

    await repository.getOrCreate(new Date('2026-07-25T15:00:00.000Z'));
    await repository.setPaused(false, new Date('2026-07-25T16:00:00.000Z'));

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'commercial-automation' },
        create: expect.objectContaining({ paused: true }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paused: false }),
      }),
    );
  });

  it('preserva os timestamps quando a pausa solicitada ja esta vigente', async () => {
    const current = {
      paused: true,
      pausedAt: new Date('2026-07-25T15:00:00.000Z'),
      resumedAt: null,
      updatedAt: new Date('2026-07-25T15:00:00.000Z'),
    };
    const update = vi.fn();
    const repository = new PrismaCommercialAutomationSettingsRepository({
      commercialAutomationSettings: {
        upsert: vi.fn().mockResolvedValue(current),
        update,
      },
    } as never);

    await expect(
      repository.setPaused(true, new Date('2026-07-25T16:00:00.000Z')),
    ).resolves.toBe(current);
    expect(update).not.toHaveBeenCalled();
  });

  it('conta somente dispatches SENT de grupos no dia e no grupo correto', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { destinationId: 'group-1', _count: { _all: 1 } },
      { destinationId: 'group-2', _count: { _all: 1 } },
    ]);
    const dispatchFindFirst = vi.fn().mockResolvedValue({
      sentAt: new Date('2026-07-25T14:30:00.000Z'),
    });
    const runFindFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: { groupBy, findFirst: dispatchFindFirst },
      commercialPipelineRun: { findFirst: runFindFirst },
    } as never);

    const result = await repository.getSnapshot({
      groupId: 'group-1',
      dayStartsAt: new Date('2026-07-25T03:00:00.000Z'),
      dayEndsAt: new Date('2026-07-26T03:00:00.000Z'),
    });

    expect(result).toEqual({
      globalSentToday: 2,
      groupSentToday: 1,
      lastSentAt: new Date('2026-07-25T14:30:00.000Z'),
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['destinationId'],
      where: {
        status: 'SENT',
        sentAt: {
          gte: new Date('2026-07-25T03:00:00.000Z'),
          lt: new Date('2026-07-26T03:00:00.000Z'),
        },
        destination: { type: 'GROUP' },
      },
      _count: { _all: true },
    });
    expect(dispatchFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'SENT',
          destination: { type: 'GROUP' },
        }),
      }),
    );
  });

  it('ignora dry-run e FAILED na contagem por consultar somente dispatch SENT', async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: {
        groupBy,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      commercialPipelineRun: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never);

    const result = await repository.getSnapshot({
      dayStartsAt: new Date('2026-07-25T03:00:00.000Z'),
      dayEndsAt: new Date('2026-07-26T03:00:00.000Z'),
    });

    expect(result.globalSentToday).toBe(0);
    expect(result.groupSentToday).toBe(0);
    expect(groupBy).toHaveBeenCalledOnce();
    expect(groupBy.mock.calls[0]?.[0]).toMatchObject({
      where: { status: 'SENT' },
    });
  });

  it('detecta finalStatus ambiguo ou investigacao pendente', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'run-ambiguous' });
    const repository = new PrismaCommercialAutomationHistoryRepository({
      whatsAppDispatch: {},
      commercialPipelineRun: { findFirst },
    } as never);

    await expect(repository.hasAmbiguousCommercialExecution()).resolves.toBe(
      true,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ finalStatus: 'AMBIGUOUS' }, { investigationRequired: true }],
      },
      select: { id: true },
    });
  });
});
