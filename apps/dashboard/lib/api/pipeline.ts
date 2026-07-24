import { apiRequest } from './client';
import type {
  PipelineJobResponse,
  PipelineRunResponse,
  ProductFilters,
} from './types';

export const runPipeline = (filters: ProductFilters) =>
  apiRequest<PipelineRunResponse>('/pipeline/run', {
    method: 'POST',
    body: { filters },
  });

export const getPipelineJob = (jobId: string) =>
  apiRequest<PipelineJobResponse>(`/pipeline/jobs/${encodeURIComponent(jobId)}`);

