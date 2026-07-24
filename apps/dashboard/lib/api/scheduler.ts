import { apiRequest } from './client';
import type { SchedulerStatus } from './types';

export const getSchedulerStatus = () =>
  apiRequest<SchedulerStatus>('/scheduler', { method: 'GET' });
