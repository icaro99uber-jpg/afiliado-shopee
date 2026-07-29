import { describe, expect, it } from 'vitest';
import {
  assertCommercialOfferSnapshotBackfillArgs,
  assertCommercialOfferSnapshotBackfillEnvironment,
  executeCommercialOfferSnapshotBackfill,
  type CommercialOfferSnapshotBackfillEnvironment,
} from '../src/commercial-offer-snapshot-backfill';
import type { CommercialOfferSnapshotBackfillRepository } from '../src/repositories';

const safeEnvironment = (): CommercialOfferSnapshotBackfillEnvironment => ({
  ci: false,
  databaseUrl: 'postgresql://local:local@127.0.0.1:5432/local',
  automationMode: 'preview',
  automationEnabled: false,
  automationPaused: true,
  schedulerEnabled: false,
  commercialSchedulerEnabled: false,
  groupSendEnabled: false,
  dispatchWorkers: 0,
});

class MemoryBackfillRepository implements CommercialOfferSnapshotBackfillRepository {
  readonly initialized = new Set<string>();
  readonly requestedLimits: number[] = [];

  constructor(
    readonly officialIds: string[],
    private readonly failOn?: string,
  ) {}

  async countOfficialProducts() {
    return this.officialIds.length;
  }

  async countOfficialProductsPendingSnapshot() {
    return this.officialIds.filter((id) => !this.initialized.has(id)).length;
  }

  async listOfficialProductIdsPendingSnapshot(limit: number) {
    this.requestedLimits.push(limit);
    return this.officialIds
      .filter((id) => !this.initialized.has(id))
      .slice(0, limit);
  }

  async initializeOfficialProductSnapshot(productId: string) {
    if (productId === this.failOn) throw new Error('controlled failure');
    if (this.initialized.has(productId)) return false;
    this.initialized.add(productId);
    return true;
  }
}

describe('commercial offer snapshot backfill', () => {
  it('exige a confirmacao exata, aceita separador do pnpm e rejeita extras', () => {
    expect(() =>
      assertCommercialOfferSnapshotBackfillArgs([
        '--',
        '--confirm-local-official-backfill',
      ]),
    ).not.toThrow();
    expect(() => assertCommercialOfferSnapshotBackfillArgs([])).toThrow();
    expect(() =>
      assertCommercialOfferSnapshotBackfillArgs([
        '--confirm-local-official-backfill',
        '--extra',
      ]),
    ).toThrow();
  });

  it.each([
    ['CI', { ci: true }],
    ['database remote', { databaseUrl: 'postgresql://host.example/db' }],
    ['send mode', { automationMode: 'send' }],
    ['automation enabled', { automationEnabled: true }],
    ['automation resumed', { automationPaused: false }],
    ['legacy scheduler', { schedulerEnabled: true }],
    ['commercial scheduler', { commercialSchedulerEnabled: true }],
    ['group send', { groupSendEnabled: true }],
    ['dispatch worker', { dispatchWorkers: 1 }],
  ] satisfies Array<
    [string, Partial<CommercialOfferSnapshotBackfillEnvironment>]
  >)('bloqueia %s', (_name, unsafe) => {
    expect(() =>
      assertCommercialOfferSnapshotBackfillEnvironment({
        ...safeEnvironment(),
        ...unsafe,
      }),
    ).toThrow();
  });

  it('processa somente os pendentes em lotes de no maximo 100 e e idempotente', async () => {
    const repository = new MemoryBackfillRepository(
      Array.from({ length: 205 }, (_, index) => `internal-${index}`),
    );
    repository.initialized.add('internal-0');
    const execute = () =>
      executeCommercialOfferSnapshotBackfill({
        args: ['--confirm-local-official-backfill'],
        environment: safeEnvironment(),
        repository,
      });

    await expect(execute()).resolves.toEqual({
      officialProductsFound: 205,
      alreadyInitialized: 1,
      initialized: 204,
      snapshotsCreated: 204,
      remaining: 0,
      completed: true,
    });
    expect(Math.max(...repository.requestedLimits)).toBe(100);
    await expect(execute()).resolves.toEqual({
      officialProductsFound: 205,
      alreadyInitialized: 205,
      initialized: 0,
      snapshotsCreated: 0,
      remaining: 0,
      completed: true,
    });
  });

  it('preserva concluidos e retoma restantes depois de interrupcao', async () => {
    const failing = new MemoryBackfillRepository(
      ['internal-1', 'internal-2', 'internal-3'],
      'internal-2',
    );
    const execute = (repository: CommercialOfferSnapshotBackfillRepository) =>
      executeCommercialOfferSnapshotBackfill({
        args: ['--confirm-local-official-backfill'],
        environment: safeEnvironment(),
        repository,
      });
    await expect(execute(failing)).rejects.toThrow('controlled failure');
    expect([...failing.initialized]).toEqual(['internal-1']);

    const resumed = new MemoryBackfillRepository(failing.officialIds);
    resumed.initialized.add('internal-1');
    await expect(execute(resumed)).resolves.toMatchObject({
      alreadyInitialized: 1,
      initialized: 2,
      snapshotsCreated: 2,
      remaining: 0,
    });
  });

  it('retorna somente contagens sanitizadas e nao chama provider externo', async () => {
    const repository = new MemoryBackfillRepository(['internal-1']);
    const report = await executeCommercialOfferSnapshotBackfill({
      args: ['--confirm-local-official-backfill'],
      environment: safeEnvironment(),
      repository,
    });
    expect(Object.keys(report)).toEqual([
      'officialProductsFound',
      'alreadyInitialized',
      'initialized',
      'snapshotsCreated',
      'remaining',
      'completed',
    ]);
    expect(JSON.stringify(report)).not.toContain('internal-1');
  });
});
