import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAnalytics } from './analytics';
import type { AnalyticsSnapshot } from './types';

const apiRequestMock = vi.fn();

vi.mock('./client', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

const snapshot: AnalyticsSnapshot = {
  totalProducts: 40,
  totalApprovedProducts: 12,
  totalGeneratedCopies: 18,
  totalQueuedDispatches: 3,
  totalSentDispatches: 10,
  totalFailedDispatches: 2,
  totalActiveDestinations: 4,
};

beforeEach(() => {
  apiRequestMock.mockReset();
});

describe('getAnalytics', () => {
  it('consulta GET /analytics pelo cliente centralizado', async () => {
    apiRequestMock.mockResolvedValue(snapshot);

    await expect(getAnalytics()).resolves.toEqual(snapshot);

    expect(apiRequestMock).toHaveBeenCalledWith('/analytics', {
      method: 'GET',
    });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });
});
