import { describe, expect, it, vi } from 'vitest';

import { AnalyticsService } from '../src/analytics-service';
import type { AnalyticsRepository } from '../src/repositories';

const createRepository = (
  values: Partial<Record<keyof AnalyticsRepository, number>> = {},
): AnalyticsRepository => ({
  totalProducts: vi.fn(async () => values.totalProducts ?? 0),
  totalApprovedProducts: vi.fn(async () => values.totalApprovedProducts ?? 0),
  totalGeneratedCopies: vi.fn(async () => values.totalGeneratedCopies ?? 0),
  totalQueuedDispatches: vi.fn(async () => values.totalQueuedDispatches ?? 0),
  totalSentDispatches: vi.fn(async () => values.totalSentDispatches ?? 0),
  totalFailedDispatches: vi.fn(async () => values.totalFailedDispatches ?? 0),
  totalActiveDestinations: vi.fn(
    async () => values.totalActiveDestinations ?? 0,
  ),
});

describe('AnalyticsService', () => {
  it('retorna um snapshot com as metricas existentes', async () => {
    const repository = createRepository({
      totalProducts: 40,
      totalApprovedProducts: 12,
      totalGeneratedCopies: 18,
      totalQueuedDispatches: 3,
      totalSentDispatches: 10,
      totalFailedDispatches: 2,
      totalActiveDestinations: 4,
    });

    await expect(
      new AnalyticsService(repository).getSnapshot(),
    ).resolves.toEqual({
      totalProducts: 40,
      totalApprovedProducts: 12,
      totalGeneratedCopies: 18,
      totalQueuedDispatches: 3,
      totalSentDispatches: 10,
      totalFailedDispatches: 2,
      totalActiveDestinations: 4,
    });

    for (const operation of Object.values(repository)) {
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it('preserva snapshot zerado quando nao existem registros', async () => {
    await expect(
      new AnalyticsService(createRepository()).getSnapshot(),
    ).resolves.toEqual({
      totalProducts: 0,
      totalApprovedProducts: 0,
      totalGeneratedCopies: 0,
      totalQueuedDispatches: 0,
      totalSentDispatches: 0,
      totalFailedDispatches: 0,
      totalActiveDestinations: 0,
    });
  });
});
