import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  PREVIEW_STABILITY_CONFIRMATION,
  assertEvidenceInvariants,
  assertNoBootstrapTick,
  assertSafePreflightEvidence,
  installPreviewStabilitySignalCleanup,
  parsePreviewStabilityArgs,
  runPreviewStabilityValidation,
  sanitizePreviewStabilityReport,
  type PreviewStabilityDependencies,
  type PreviewStabilityEvidence,
  type PreviewStabilityReport,
} from '../src/preview-stability';
import {
  createPreviewStabilityDependencies,
  stopValidatedManagedProcess,
} from '../src/preview-stability-runtime';
import type { SystemStatusSnapshot } from '../src/supervisor';
import {
  LocalSystemError,
  type LocalSystemState,
  type SystemDependencies,
} from '../src/types';

const ROOT = resolve(import.meta.dirname, '../../..');

const status = (
  overall: SystemStatusSnapshot['overall'] = 'stopped',
  operationLock: SystemStatusSnapshot['operationLock'] = 'unlocked',
): SystemStatusSnapshot => ({
  overall,
  operationLock,
  mode: 'preview',
  docker: { daemon: 'available', services: [] },
  evolution: {
    api: 'unavailable',
    services: [],
    whatsappConnection: 'not-configured',
  },
  processes: {
    api: overall === 'running' ? 'running' : 'stopped',
    dashboard: overall === 'running' ? 'running' : 'stopped',
    'commercial-worker': overall === 'running' ? 'running' : 'stopped',
    'whatsapp-dispatch-worker': 'not-required',
  },
  endpoints: {
    api: overall === 'running' ? 'available' : 'unavailable',
    dashboard: overall === 'running' ? 'available' : 'unavailable',
  },
  schedulers: {
    legacy: {
      enabled: false,
      status: 'disabled',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    },
    commercial: {
      enabled: overall === 'running',
      status: overall === 'running' ? 'registered' : 'unavailable',
      cron: overall === 'running' ? '*/1 * * * *' : null,
      timezone: overall === 'running' ? 'America/Sao_Paulo' : null,
      nextRunAt: null,
      mode: 'preview',
    },
  },
  automation: {
    enabled: overall === 'running',
    allowed: false,
    paused: true,
    reasons: [],
    nextAllowedAt: null,
  },
  externalPortOccupants: [],
});

const evidence = (
  overrides: Partial<PreviewStabilityEvidence> = {},
): PreviewStabilityEvidence => ({
  migrations: {
    applied: 11,
    failed: 0,
    pending: 0,
    unexpected: 0,
    baselineRegistered: true,
    schemaMatchesCurrent: true,
  },
  settings: { present: true, paused: true },
  executions: [],
  runs: { total: 2, dryRun: 2, ambiguous: 0, investigationRequired: 0 },
  dispatches: { total: 1, processing: 0 },
  outboxes: { total: 0, pending: 0, ambiguous: 0 },
  queues: {
    commercialJobIds: [],
    whatsappJobIds: ['historical-whatsapp-job'],
    productJobIds: [],
    commercialSchedulerIds: [],
    legacySchedulerIds: [],
  },
  tableCounts: {
    CommercialAutomationExecution: 0,
    CommercialPipelineRun: 2,
    WhatsAppDispatch: 1,
    CommercialDispatchOutbox: 0,
  },
  ...overrides,
});

const createFakeDependencies = (
  options: {
    initialStatus?: SystemStatusSnapshot;
    unsafeInitialEvidence?: PreviewStabilityEvidence;
    failStartAt?: number;
  } = {},
) => {
  let clock = new Date('2026-07-28T12:00:00.000Z');
  let systemStatus = options.initialStatus ?? status();
  let paused = true;
  let schedulerEnabled = false;
  let tickCount = 0;
  let captureCount = 0;
  let startCount = 0;
  const reports: PreviewStabilityReport[] = [];
  const calls: string[] = [];
  const snapshot = () =>
    evidence({
      settings: { present: true, paused },
      executions: Array.from({ length: tickCount }, (_, index) => ({
        id: `execution-${index + 1}`,
        bullMqJobId: `job-${index + 1}`,
        status: 'PREVIEW_READY' as const,
        stale: false,
      })),
      runs: {
        total: 2 + tickCount,
        dryRun: 2 + tickCount,
        ambiguous: 0,
        investigationRequired: 0,
      },
      queues: {
        commercialJobIds: Array.from(
          { length: tickCount },
          (_, index) => `job-${index + 1}`,
        ),
        whatsappJobIds: ['historical-whatsapp-job'],
        productJobIds: [],
        commercialSchedulerIds: schedulerEnabled
          ? ['scheduled-commercial-automation']
          : [],
        legacySchedulerIds: [],
      },
    });
  const dependencies: PreviewStabilityDependencies = {
    now: () => clock,
    sleep: async (milliseconds) => {
      clock = new Date(clock.getTime() + milliseconds);
      if (systemStatus.overall === 'running' && schedulerEnabled && !paused) {
        tickCount += 1;
      }
    },
    status: async () => systemStatus,
    prepareMainInfrastructure: async () => {
      calls.push('prepare-infrastructure');
    },
    stopMainInfrastructure: async () => {
      calls.push('stop-infrastructure');
    },
    startSystem: async (environment) => {
      calls.push('start-system');
      startCount += 1;
      if (startCount === options.failStartAt) {
        systemStatus = status('partial');
        throw new LocalSystemError(
          'Falha parcial simulada',
          'SIMULATED_PARTIAL_START_FAILURE',
        );
      }
      schedulerEnabled = environment.COMMERCIAL_SCHEDULER_ENABLED === 'true';
      systemStatus = status('running');
      if (!schedulerEnabled) {
        systemStatus.schedulers.commercial.status = 'disabled';
      }
      return systemStatus;
    },
    stopSystem: async () => {
      calls.push('stop-system');
      systemStatus = status('stopped');
    },
    setAutomationPaused: async (value) => {
      calls.push(value ? 'pause' : 'resume');
      paused = value;
    },
    forceAutomationPaused: async () => {
      calls.push('force-pause');
      paused = true;
    },
    resolvePreviewGroupInstance: async () => 'persisted-preview-instance',
    captureEvidence: async () => {
      captureCount += 1;
      if (captureCount === 1 && options.unsafeInitialEvidence) {
        return options.unsafeInitialEvidence;
      }
      return snapshot();
    },
    captureExecutions: async () => snapshot().executions,
    captureInfrastructure: async () => ({
      volumeCount: 2,
      volumeFingerprint: 'volume-fingerprint',
      containers: { postgres: systemStatus.overall },
      envFingerprint: 'env-fingerprint',
    }),
    killManagedProcess: async (service) => {
      calls.push(`kill-${service}`);
      systemStatus = status('partial');
    },
    restartMainService: async (service) => {
      calls.push(`restart-${service}`);
      return { unavailableMs: 5_000 };
    },
    waitForSafeTickGap: async () => {
      calls.push('safe-gap');
      return clock.getTime() + 60_000;
    },
    writeReport: async (report) => {
      reports.push(report);
    },
  };
  return { dependencies, calls, reports };
};

describe('preview operational stability', () => {
  it('accepts only the exact local confirmation', () => {
    expect(() =>
      parsePreviewStabilityArgs([PREVIEW_STABILITY_CONFIRMATION]),
    ).not.toThrow();
    expect(() =>
      parsePreviewStabilityArgs(['--', PREVIEW_STABILITY_CONFIRMATION]),
    ).not.toThrow();
    for (const args of [
      [],
      ['--confirm'],
      [PREVIEW_STABILITY_CONFIRMATION, '--extra'],
      ['--', '--', PREVIEW_STABILITY_CONFIRMATION],
    ]) {
      expect(() => parsePreviewStabilityArgs(args)).toThrow(LocalSystemError);
    }
  });

  it('accepts a safe preflight and rejects unsafe commercial state', () => {
    expect(() => assertSafePreflightEvidence(evidence())).not.toThrow();
    expect(() =>
      assertSafePreflightEvidence(
        evidence({
          executions: [
            {
              id: 'historical-manual-execution',
              bullMqJobId: null,
              status: 'PREVIEW_READY',
              stale: false,
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSafePreflightEvidence(
        evidence({ outboxes: { total: 1, pending: 1, ambiguous: 0 } }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
      }),
    );
    expect(() =>
      assertSafePreflightEvidence(
        evidence({
          queues: {
            commercialJobIds: [],
            whatsappJobIds: [],
            productJobIds: [],
            commercialSchedulerIds: ['scheduled-commercial-automation'],
            legacySchedulerIds: [],
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_COMMERCIAL_SCHEDULER_PRESENT',
      }),
    );
    expect(() =>
      assertSafePreflightEvidence(
        evidence({
          migrations: {
            applied: 11,
            failed: 0,
            pending: 0,
            unexpected: 0,
            baselineRegistered: true,
            schemaMatchesCurrent: false,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_MIGRATIONS_UNSAFE',
      }),
    );
  });

  it.each([
    [
      'active system',
      status('running'),
      'PREVIEW_STABILITY_SYSTEM_ALREADY_ACTIVE',
    ],
    [
      'busy lock',
      status('stopped', 'active'),
      'PREVIEW_STABILITY_OPERATION_LOCKED',
    ],
  ])(
    'blocks %s without mutating the existing state',
    async (_label, initial, code) => {
      const fake = createFakeDependencies({ initialStatus: initial });
      await expect(
        runPreviewStabilityValidation({
          args: [PREVIEW_STABILITY_CONFIRMATION],
          processEnvironment: {},
          dependencies: fake.dependencies,
        }),
      ).rejects.toMatchObject({ code });
      expect(fake.calls).toEqual([]);
      expect(fake.reports.at(-1)).toMatchObject({
        status: 'failed',
        finalState: {
          system: initial.overall,
          operationLock: initial.operationLock,
        },
      });
    },
  );

  it('cleans up after unsafe evidence without attempting recovery', async () => {
    const fake = createFakeDependencies({
      unsafeInitialEvidence: evidence({
        executions: [
          {
            id: 'ambiguous',
            bullMqJobId: 'ambiguous-job',
            status: 'AMBIGUOUS',
            stale: false,
          },
        ],
      }),
    });
    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
    });
    expect(fake.calls).not.toContain('resume');
    expect(fake.calls).toContain('force-pause');
    expect(fake.calls).toContain('stop-system');
  });

  it('stops partially started infrastructure when restoration start fails', async () => {
    const fake = createFakeDependencies({
      failStartAt: 1,
      unsafeInitialEvidence: evidence({
        outboxes: { total: 1, pending: 1, ambiguous: 0 },
      }),
    });
    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_COMMERCIAL_STATE_UNSAFE',
    });
    expect(fake.calls.filter((call) => call === 'stop-system')).toHaveLength(1);
    expect(fake.reports.at(-1)).toMatchObject({
      status: 'failed',
      finalState: { system: 'stopped', managedProcessesActive: 0 },
    });
  });

  it('executes every scenario, observes five previews and removes schedulers', async () => {
    const fake = createFakeDependencies();
    await runPreviewStabilityValidation({
      args: [PREVIEW_STABILITY_CONFIRMATION],
      processEnvironment: {
        DATABASE_URL:
          'postgresql://sensitive-user:sensitive-password@localhost/app',
      },
      dependencies: fake.dependencies,
    });
    const report = fake.reports.at(-1)!;
    expect(report.status).toBe('completed');
    expect(report.scenarios).toHaveLength(8);
    expect(report.ticksObserved).toBeGreaterThanOrEqual(5);
    expect(report.failuresInjected).toEqual([
      'commercial-worker-stopped',
      'api-stopped',
      'redis-temporarily-stopped',
      'postgres-temporarily-stopped',
    ]);
    expect(report.invariants).toMatchObject({
      noDispatchCreated: true,
      noOutboxCreated: true,
      noWhatsappJobCreated: true,
      noProductJobCreated: true,
      noDuplicateBullMqJobId: true,
      commercialSchedulerRemoved: true,
      volumesPreserved: true,
    });
    expect(fake.calls.filter((call) => call.startsWith('kill-'))).toEqual([
      'kill-commercial-worker',
      'kill-api',
    ]);
    expect(fake.calls.filter((call) => call.startsWith('restart-'))).toEqual([
      'restart-redis',
      'restart-postgres',
    ]);
    expect(JSON.stringify(report)).not.toMatch(
      /sensitive-user|sensitive-password|postgresql:\/\//,
    );
    expect(
      sanitizePreviewStabilityReport({
        ...report,
        databaseUrl: 'postgresql://sensitive-user:sensitive-password@host/db',
      } as PreviewStabilityReport & { databaseUrl: string }),
    ).not.toHaveProperty('databaseUrl');
  });

  it('detects forbidden deltas and duplicate BullMQ identities', () => {
    const before = evidence();
    expect(() =>
      assertEvidenceInvariants(
        before,
        evidence({ dispatches: { total: 2, processing: 0 } }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_INVARIANT_VIOLATION',
      }),
    );
    expect(() =>
      assertEvidenceInvariants(
        before,
        evidence({
          executions: [
            {
              id: 'one',
              bullMqJobId: 'same-job',
              status: 'PREVIEW_READY',
              stale: false,
            },
            {
              id: 'two',
              bullMqJobId: 'same-job',
              status: 'PREVIEW_READY',
              stale: false,
            },
          ],
        }),
      ),
    ).toThrow(LocalSystemError);
  });

  it('distinguishes a due scheduled tick from an immediate bootstrap tick', () => {
    const before = evidence();
    const scheduledAt = Date.parse('2026-07-28T12:01:00.000Z');
    const execution = (bullMqJobId: string) =>
      evidence({
        executions: [
          {
            id: 'new-execution',
            bullMqJobId,
            status: 'PREVIEW_READY',
            stale: false,
          },
        ],
      });
    expect(() =>
      assertNoBootstrapTick(
        before,
        execution(`repeat:scheduled-commercial-automation:${scheduledAt}`),
        scheduledAt,
      ),
    ).not.toThrow();
    expect(() =>
      assertNoBootstrapTick(
        before,
        execution('immediate-bootstrap-job'),
        scheduledAt,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'PREVIEW_STABILITY_BOOTSTRAP_TICK_DETECTED',
      }),
    );
  });

  it('turns SIGINT and SIGTERM into serialized interruption requests', () => {
    const handlers = new Map<string, () => void>();
    const requestInterruption = vi.fn();
    const runtime = {
      once: vi.fn((signal: string, handler: () => void) => {
        handlers.set(signal, handler);
        return runtime;
      }),
      off: vi.fn(() => runtime),
    };
    const remove = installPreviewStabilitySignalCleanup(
      requestInterruption,
      runtime,
    );
    handlers.get('SIGINT')?.();
    handlers.get('SIGTERM')?.();
    expect(requestInterruption).toHaveBeenNthCalledWith(1, 130);
    expect(requestInterruption).toHaveBeenNthCalledWith(2, 143);
    remove();
    expect(runtime.off).toHaveBeenCalledTimes(2);
  });

  it('restores the topology and writes a failed report after a signal', async () => {
    const fake = createFakeDependencies();
    const handlers = new Map<string, () => void>();
    const signalRuntime = {
      once: vi.fn((signal: string, handler: () => void) => {
        handlers.set(signal, handler);
        return signalRuntime;
      }),
      off: vi.fn(() => signalRuntime),
    };
    const originalSleep = fake.dependencies.sleep;
    fake.dependencies.sleep = async (milliseconds) => {
      await originalSleep(milliseconds);
      handlers.get('SIGINT')?.();
    };

    await expect(
      runPreviewStabilityValidation({
        args: [PREVIEW_STABILITY_CONFIRMATION],
        processEnvironment: {},
        dependencies: fake.dependencies,
        signalRuntime,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_INTERRUPTED_SIGINT',
    });
    expect(fake.calls).toContain('pause');
    expect(fake.calls.filter((call) => call === 'stop-system')).toHaveLength(2);
    expect(fake.reports.at(-1)).toMatchObject({
      status: 'failed',
      failureCode: 'PREVIEW_STABILITY_INTERRUPTED_SIGINT',
      finalState: { system: 'stopped', automationPaused: true },
    });
  });

  it('never stops a registered PID when its identity diverges', async () => {
    const stopProcessTree = vi.fn(async () => true);
    const dependencies = {
      inspectProcess: vi.fn(async () => ({
        running: true,
        identityMatches: false,
      })),
      stopProcessTree,
    } as unknown as SystemDependencies;
    const state: LocalSystemState = {
      version: 1,
      startedAt: '2026-07-28T12:00:00.000Z',
      mode: 'preview',
      ports: {
        api: 3333,
        dashboard: 3000,
        postgres: 5432,
        redis: 6379,
        evolution: 8080,
      },
      processes: {
        api: {
          pid: 999,
          startedAt: '2026-07-28T12:00:00.000Z',
          log: '.runtime/local-system/api.log',
        },
      },
    };
    await expect(
      stopValidatedManagedProcess({
        service: 'api',
        state,
        specs: [
          {
            name: 'api',
            command: 'node',
            args: [],
            marker: 'server.ts',
          },
        ],
        dependencies,
      }),
    ).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_MANAGED_PROCESS_IDENTITY_MISMATCH',
    });
    expect(stopProcessTree).not.toHaveBeenCalled();
  });

  it.each(['redis', 'postgres'] as const)(
    'restarts only %s with compose stop/start and never removes volumes',
    async (service) => {
      let now = new Date('2026-07-28T12:00:00.000Z');
      const commands: string[][] = [];
      const dependencies = {
        run: vi.fn(async (spec: { args: string[] }) => {
          commands.push(spec.args);
          return spec.args.includes('ps')
            ? {
                code: 0,
                stdout: JSON.stringify({
                  Service: service,
                  State: 'running',
                  Health: 'healthy',
                }),
                stderr: '',
              }
            : { code: 0, stdout: '', stderr: '' };
        }),
        sleep: vi.fn(async (milliseconds: number) => {
          now = new Date(now.getTime() + milliseconds);
        }),
        now: () => now,
      } as unknown as SystemDependencies;
      const runtime = createPreviewStabilityDependencies(ROOT, dependencies);
      await runtime.restartMainService(service, {});
      expect(commands).toContainEqual(['compose', 'stop', service]);
      expect(commands).toContainEqual(['compose', 'start', service]);
      expect(commands.flat()).not.toContain('down');
      expect(commands.flat()).not.toContain('-v');
    },
  );

  it('rejects infrastructure fingerprints when a Docker capture fails', async () => {
    const dependencies = {
      run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'sensitive' })),
    } as unknown as SystemDependencies;
    const runtime = createPreviewStabilityDependencies(ROOT, dependencies);
    await expect(runtime.captureInfrastructure({})).rejects.toMatchObject({
      code: 'PREVIEW_STABILITY_MAIN_CONTAINER_CAPTURE_FAILED',
    });
  });
});
