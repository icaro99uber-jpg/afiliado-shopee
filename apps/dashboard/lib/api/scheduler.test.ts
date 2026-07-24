import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSchedulerStatus } from './scheduler';
import type { SchedulerStatus } from './types';

const apiRequestMock = vi.fn();

vi.mock('./client', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

const status: SchedulerStatus = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduled-pipeline-product',
  queue: 'product-pipeline',
  jobName: 'pipeline-product',
  cronExpression: '0 8 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-07-25T11:00:00.000Z',
};

beforeEach(() => {
  apiRequestMock.mockReset();
});

describe('getSchedulerStatus', () => {
  it('consulta GET /scheduler pelo cliente centralizado', async () => {
    apiRequestMock.mockResolvedValue(status);

    await expect(getSchedulerStatus()).resolves.toEqual(status);

    expect(apiRequestMock).toHaveBeenCalledWith('/scheduler', {
      method: 'GET',
    });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });
});
