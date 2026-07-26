import { apiRequest } from './client';
import type { CommercialAutomationStatus } from './types';

export const getCommercialAutomationStatus = () =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/status', {
    method: 'GET',
  });

export const pauseCommercialAutomation = () =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/settings', {
    method: 'PATCH',
    body: { paused: true },
  });

export const resumeCommercialAutomation = (confirmation: string) =>
  apiRequest<CommercialAutomationStatus>('/commercial-automation/settings', {
    method: 'PATCH',
    body: { paused: false, confirmation },
  });
