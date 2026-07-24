import { apiRequest } from './client';
import type { AnalyticsSnapshot } from './types';

export const getAnalytics = () =>
  apiRequest<AnalyticsSnapshot>('/analytics', { method: 'GET' });
