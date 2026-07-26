import { describe, expect, it, vi } from 'vitest';

import { finalizeCommercialPipelineRun } from '../src/commercial-pipeline-run-finalizer';
import type {
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  WhatsAppDispatchRecord,
} from '../src/repositories';

const now = new Date('2026-07-25T23:00:00.000Z');

const build = (investigationRequired = false) => {
  let run: CommercialPipelineRunRecord = {
    id: 'run-id',
    mode: 'CONFIRMED',
    status: 'STARTED',
    candidateCount: 1,
    eligibleCount: 1,
    rejectedCount: 0,
    rejectionSummary: {},
    selectionReasons: [],
    plannedSubIds: [],
    dispatchId: 'dispatch-id',
    finalStatus: 'PENDING',
    investigationRequired,
    createdAt: now,
  };
  const runs = {
    findByDispatchId: async (id: string) => (id === 'dispatch-id' ? run : null),
    update: async (_id: string, data: Partial<typeof run>) => {
      run = { ...run, ...data };
      return run;
    },
  } as CommercialPipelineRunRepository;
  return { runs, getRun: () => run };
};

const dispatch = (
  status: 'SENT' | 'FAILED' | 'PENDING',
): WhatsAppDispatchRecord => ({
  id: 'dispatch-id',
  productId: 'product-id',
  generatedCopyId: 'copy-id',
  destinationId: 'group-id',
  status,
  attemptCount: 1,
  externalMessageId: status === 'SENT' ? 'recorded-internally' : null,
});

describe('finalizeCommercialPipelineRun', () => {
  it('persiste SENT e uma tentativa no run confirmado', async () => {
    const state = build();
    await finalizeCommercialPipelineRun({
      runs: state.runs,
      dispatch: dispatch('SENT'),
      failed: false,
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });
    expect(state.getRun()).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
      completedAt: now,
    });
  });

  it('persiste falha sem autorizar retry', async () => {
    const state = build();
    await finalizeCommercialPipelineRun({
      runs: state.runs,
      dispatch: dispatch('FAILED'),
      failed: true,
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });
    expect(state.getRun()).toMatchObject({
      status: 'FAILED',
      finalStatus: 'FAILED',
      failureCode: 'COMMERCIAL_DISPATCH_FAILED',
      investigationRequired: true,
    });
  });

  it('preserva estado ambiguo registrado por timeout', async () => {
    const state = build(true);
    await finalizeCommercialPipelineRun({
      runs: state.runs,
      dispatch: dispatch('SENT'),
      failed: false,
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });
    expect(state.getRun()).toMatchObject({
      finalStatus: 'PENDING',
      investigationRequired: true,
    });
  });
});
