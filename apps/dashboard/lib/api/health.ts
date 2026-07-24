import { apiRequest } from './client';
import type { HealthResponse } from './types';

export const getHealth = () => apiRequest<HealthResponse>('/health');

