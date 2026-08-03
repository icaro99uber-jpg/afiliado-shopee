import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maskEvolutionDestination } from '@shopee-auto-affiliate-ai/providers';
import {
  runCommercialImageDispatchE2E,
  COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG,
  type CommercialImageDispatchE2ERuntime,
  type CommercialImageDispatchE2EReadOnlyRuntime,
} from '../src/commercial-image-dispatch-e2e';
import type { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import type { WhatsAppDestinationRecord, GeneratedCopyRecord, WhatsAppDispatchDetails, CommercialPromotionCandidateRecord, CommercialPromotionSnapshotRecord, WhatsAppDispatchRecord } from '../../api/src/repositories';
import type { ApplicationRepositories } from '../../api/src/application-services';
import type { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';

const DESTINATION = '0000000000000';
const API_KEY = 'unit-test-api-key-never-real';
const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  WHATSAPP_PROVIDER: 'evolution',
  EVOLUTION_API_URL: 'http://localhost:8080',
  EVOLUTION_API_KEY: API_KEY,
  EVOLUTION_INSTANCE_NAME: 'afiliado-shopee-local',
  EVOLUTION_SAFE_MODE: 'true',
  EVOLUTION_ALLOWED_DESTINATIONS: DESTINATION,
  EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
  SCHEDULER_ENABLED: 'false',
};

const preflight = vi.fn(async () => ({
  databaseAvailable: true as const,
  redisAvailable: true as const,
  evolutionAvailable: true as const,
  evolutionVersion: '2.3.7' as const,
  instanceStatus: 'open' as const,
}));

const createLogger = () => ({ info: vi.fn(), error: vi.fn() });

type TestCandidate = CommercialPromotionCandidateRecord & { 
  product: { affiliateLink: string }, 
  snapshot: CommercialPromotionSnapshotRecord, 
  generatedCopy: GeneratedCopyRecord 
};

type RuntimeState = {
  activeCount: number;
  workerCount: number;
  dispatch: WhatsAppDispatchRecord | null;
  apiDispatch: WhatsAppDispatchDetails | null;
  job: { id: string; waitUntilFinished: () => Promise<void> } | null;
  candidates: Record<string, TestCandidate>;
  copies: Record<string, GeneratedCopyRecord>;
  destinations: Record<string, WhatsAppDestinationRecord>;
  snapshots: Record<string, CommercialPromotionSnapshotRecord>;
  dispatches: WhatsAppDispatchRecord[];
};

type PrismaClientType = ReturnType<typeof createPrismaClient>;

const createMockReadOnlyRuntimeFactory = (state: RuntimeState) => {
  return async (): Promise<CommercialImageDispatchE2EReadOnlyRuntime> => {
    return {
      repositories: {
        commercialPromotionCandidates: {
          findById: vi.fn(async (id: string) => state.candidates[id] as never),
        },
        commercialOfferSnapshots: {
          findById: vi.fn(async (id: string) => state.snapshots[id] as never),
        },
        whatsappDestinations: {
          findById: vi.fn(async (id: string) => state.destinations[id] || null),
        },
        whatsappDispatches: {
          list: vi.fn(async () => state.dispatches as never),
        },
        generatedCopies: {
          findById: vi.fn(async (id: string) => state.copies[id] || null),
        },
      } as never as ApplicationRepositories,
      prisma: {
        commercialPromotionCandidate: {
          findUnique: vi.fn(async (args: { where: { id: string } }) => state.candidates[args.where.id] || null)
        },
      } as never as PrismaClientType,
      draftService: {
        createDraft: vi.fn(() => ({
          deliveryMode: 'IMAGE',
          imageUrl: 'https://example.invalid/image.jpg',
          caption: 'Promo test https://shope.ee/test',
          warnings: []
        }))
      } as never as CommercialMessageDraftService,
      close: vi.fn(),
    };
  };
};

const createMockRuntimeFactory = (state: RuntimeState) => {
  return async (): Promise<CommercialImageDispatchE2ERuntime> => {
    const ro = await createMockReadOnlyRuntimeFactory(state)();
    return {
      repositories: {
        ...ro.repositories,
        whatsappDispatches: {
          ...ro.repositories.whatsappDispatches,
          findByIdWithDetails: vi.fn(async () => state.dispatch as never),
          createPending: vi.fn(async (data: { id: string; productId: string; generatedCopyId: string; destinationId: string }) => {
            const newDispatch: WhatsAppDispatchRecord = {
              ...data,
              status: 'PENDING',
              attemptCount: 0,
              externalMessageId: null,
              sentAt: null,
              errorMessage: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            state.dispatch = newDispatch;
            state.dispatches.push(newDispatch);
            return state.dispatch as never;
          }),
        },
      } as never as ApplicationRepositories,
      prisma: {
        ...ro.prisma,
        whatsAppDispatch: {
          findUnique: vi.fn(async (args: { where: { id: string } }) => state.dispatches.find(d => d.id === args.where.id) || null)
        }
      } as never as PrismaClientType,
      draftService: ro.draftService,
      assertNoCompetingWork: vi.fn(async () => {
        if (state.activeCount > 0 || state.workerCount > 0)
          throw new Error('Ha worker ou pipeline ativo; execucao E2E bloqueada');
      }),
      findJob: vi.fn(async () => state.job as never),
      enqueue: vi.fn(async (dispatchId: string, jobId: string) => {
        state.job = { id: jobId, waitUntilFinished: vi.fn() };
        return state.job as never;
      }),
      startWorker: vi.fn(),
      waitForJob: vi.fn(async () => {
        if (state.dispatch) {
          state.dispatch.status = 'SENT';
          state.dispatch.attemptCount = 1;
          state.dispatch.externalMessageId = 'mock-id';
          state.dispatch.sentAt = new Date();
        }
      }),
      queryDispatchApi: vi.fn(async () => state.apiDispatch as never),
      close: vi.fn(),
    };
  };
};

describe('Commercial Image Dispatch E2E CLI', () => {
  let logger: ReturnType<typeof createLogger>;
  let state: RuntimeState;
  
  beforeEach(() => {
    vi.clearAllMocks();
    logger = createLogger();
    
    const snap = {
      id: 'snap-1', productId: 'product-1', revision: 1, unavailableAt: null, offerEndsAt: null,
      discountRate: null, commissionRate: null, currentPrice: null, snapshotAt: new Date(),
      ratingCount: null, ratingStar: null, historicalSold: null
    } as never as CommercialPromotionSnapshotRecord;
    
    const copy: GeneratedCopyRecord = {
      id: 'copy-1', productId: 'product-1', createdFromCandidateId: 'candidate-1', snapshotId: 'snap-1',
      titulo: 'T', mensagem: 'M', cta: 'C', hashtags: 'H', createdAt: new Date()
    };
    
    state = {
      activeCount: 0,
      workerCount: 0,
      dispatch: null,
      apiDispatch: null,
      job: null,
      candidates: {
        'candidate-1': {
          id: 'candidate-1',
          productId: 'product-1',
          snapshotId: 'snap-1',
          generatedCopyId: 'copy-1',
          status: 'COPY_READY',
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          product: { affiliateLink: 'https://shope.ee/test' },
          snapshot: snap,
          generatedCopy: copy
        } as never as TestCandidate
      },
      copies: {
        'copy-1': copy
      },
      destinations: {
        'dest-1': { id: 'dest-1', name: 'L', type: 'INDIVIDUAL', destination: DESTINATION, active: true, available: true, createdAt: new Date(), updatedAt: new Date() } as never as WhatsAppDestinationRecord
      },
      snapshots: {
        'snap-1': snap
      },
      dispatches: []
    };
    state.apiDispatch = {
      id: 'dispatch-e2e-candidate-1-copy-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'mock-id',
      sentAt: new Date(),
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      destination: { type: 'INDIVIDUAL', destination: maskEvolutionDestination(DESTINATION), active: true, available: true } as never,
      generatedCopy: copy
    } as never as WhatsAppDispatchDetails;
  });

  const runWithEnv = (args: string[], envOverrides = {}) =>
    runCommercialImageDispatchE2E({
      args,
      env: { ...baseEnv, ...envOverrides },
      readEnvFile: () => '',
      logger,
      preflight,
      readOnlyRuntimeFactory: createMockReadOnlyRuntimeFactory(state),
      runtimeFactory: createMockRuntimeFactory(state),
    });

  it('dry-run performs no DB writes or provider calls', async () => {
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dry-run', result: 'GO' })
    );
    expect(state.dispatches).toHaveLength(0);
  });

  it('missing flag blocks real execution (runs dry-run)', async () => {
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'dry-run' })
    );
  });

  it('incorrect flag block (invalid args)', async () => {
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--wrong-flag'
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('candidate or copy mismatch blocks execution', async () => {
    state.copies['copy-1'] = { ...state.copies['copy-1'], createdFromCandidateId: 'other-candidate' };
    state.candidates['candidate-1'].generatedCopy = { ...state.candidates['candidate-1'].generatedCopy, createdFromCandidateId: 'other-candidate' };
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_RELATION_MISMATCH' })
    );
  });

  it('inactive destination blocks execution', async () => {
    state.destinations['dest-1'].active = false;
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_DESTINATION_UNAVAILABLE' })
    );
  });

  it('destination not in allowlist blocks execution', async () => {
    state.destinations['dest-1'] = { ...state.destinations['dest-1'], destination: '5511999999999' } as never as WhatsAppDestinationRecord;
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_DESTINATION_NOT_ALLOWED' })
    );
  });

  it('previous dispatch blocks execution', async () => {
    state.dispatches.push({
      id: 'dispatch-e2e-candidate-1-copy-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: null,
      sentAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never as WhatsAppDispatchRecord);
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1'
    ]);
    expect(result.exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMMERCIAL_E2E_PREVIOUS_DISPATCH_BLOCKED' })
    );
  });

  it('real mode success path', async () => {
    state.dispatch = {
      id: 'dispatch-e2e-candidate-1-copy-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'dest-1',
      status: 'PENDING',
      attemptCount: 0,
      externalMessageId: null,
      sentAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never as WhatsAppDispatchRecord;
    const result = await runWithEnv([
      '--candidate-id', 'candidate-1',
      '--copy-id', 'copy-1',
      '--destination-id', 'dest-1',
      `--${COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG}`
    ]);
    expect(result.exitCode).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'confirmed',
        status: 'SENT',
        attemptCount: 1,
        externalMessageIdPresent: true,
      })
    );
  });
});
