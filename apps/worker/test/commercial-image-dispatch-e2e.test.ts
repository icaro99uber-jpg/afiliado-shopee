import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  maskEvolutionDestination,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  executeCommercialImageDispatchE2E,
  runCommercialImageDispatchE2E,
  COMMERCIAL_IMAGE_DISPATCH_E2E_REAL_FLAG,
  type CommercialImageDispatchE2ERuntime,
} from '../src/commercial-image-dispatch-e2e';
import { processWhatsAppDispatchJob } from '../src/whatsapp-dispatch-worker';

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

type RuntimeState = {
  activeCount: number;
  workerCount: number;
  dispatch: any;
  apiDispatch: any;
  job: any;
  candidates: Record<string, any>;
  copies: Record<string, any>;
  destinations: Record<string, any>;
  snapshots: Record<string, any>;
  dispatches: any[];
};

const createMockRuntimeFactory = (state: RuntimeState) => {
  return async (): Promise<CommercialImageDispatchE2ERuntime> => {
    return {
      repositories: {
        commercialPromotionCandidates: {
          findById: vi.fn(async (id) => state.candidates[id]),
        },
        generatedCopies: {
          findById: vi.fn(async (id) => state.copies[id]),
        },
        whatsappDestinations: {
          findById: vi.fn(async (id) => state.destinations[id]),
        },
        commercialOfferSnapshots: {
          findById: vi.fn(async (id) => state.snapshots[id]),
        },
        whatsappDispatches: {
          findById: vi.fn(async (id) => state.dispatches.find(d => d.id === id) || null),
          findByIdWithDetails: vi.fn(async () => state.dispatch),
          list: vi.fn(async () => state.dispatches),
          createPending: vi.fn(async (data) => {
            const newDispatch = { ...data, status: 'PENDING', attemptCount: 0 };
            state.dispatch = newDispatch;
            state.dispatches.push(newDispatch);
            return newDispatch;
          }),
        },
      } as any,
      prisma: {
        commercialPromotionCandidate: {
          findUnique: vi.fn(async (args) => state.candidates[args.where.id] || null)
        },
        commercialOfferSnapshot: {
          findUnique: vi.fn(async (args) => state.snapshots[args.where.id] || null)
        },
        whatsAppDispatch: {
          findUnique: vi.fn(async (args) => state.dispatches.find(d => d.id === args.where.id) || null)
        }
      } as any,
      draftService: {
        createDraft: vi.fn(() => ({
          deliveryMode: 'IMAGE',
          imageUrl: 'https://example.invalid/image.jpg',
          caption: 'Promo test https://shope.ee/test',
          warnings: []
        }))
      } as any,
      assertNoCompetingWork: vi.fn(async () => {
        if (state.activeCount > 0 || state.workerCount > 0)
          throw new Error('Ha worker ou pipeline ativo; execucao E2E bloqueada');
      }),
      findJob: vi.fn(async () => state.job),
      enqueue: vi.fn(async (dispatchId, jobId) => {
        state.job = { id: jobId, waitUntilFinished: vi.fn() };
        return state.job;
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
      queryDispatchApi: vi.fn(async () => state.apiDispatch),
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
    state = {
      activeCount: 0,
      workerCount: 0,
      dispatch: null,
      apiDispatch: null,
      job: null,
      candidates: {
        'candidate-1': { id: 'candidate-1', productId: 'product-1', snapshotId: 'snap-1' }
      },
      copies: {
        'copy-1': { id: 'copy-1', productId: 'product-1', createdFromCandidateId: 'candidate-1' }
      },
      destinations: {
        'dest-1': { id: 'dest-1', destination: DESTINATION, active: true, available: true }
      },
      snapshots: {
        'snap-1': { id: 'snap-1' }
      },
      dispatches: []
    };
    state.apiDispatch = {
      id: 'dispatch-e2e-candidate-1-copy-1',
      status: 'SENT',
      attemptCount: 1,
      destination: { destination: maskEvolutionDestination(DESTINATION) },
      generatedCopy: { titulo: 'T', mensagem: 'M' }
    };
  });

  const runWithEnv = (args: string[], envOverrides = {}) =>
    runCommercialImageDispatchE2E({
      args,
      env: { ...baseEnv, ...envOverrides },
      readEnvFile: () => '',
      logger,
      preflight,
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
    state.copies['copy-1'].createdFromCandidateId = 'other-candidate';
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
    state.destinations['dest-1'].destination = '5511999999999';
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
      destinationId: 'dest-1'
    });
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
    state.dispatch = { status: 'PENDING', id: 'dispatch-e2e-candidate-1-copy-1', attemptCount: 0 };
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
