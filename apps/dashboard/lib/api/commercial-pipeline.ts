import { apiRequest } from './client';
import type {
  CommercialPipelineDryRunResult,
  CommercialPipelineInput,
  CommercialPipelineRun,
  CommercialPipelineRunPage,
} from './types';

export const runCommercialPipelineDryRun = (input: CommercialPipelineInput) =>
  apiRequest<CommercialPipelineDryRunResult>('/commercial-pipeline/dry-run', {
    method: 'POST',
    body: input,
  });

export const listCommercialPipelineRuns = (page = 1, limit = 10) =>
  apiRequest<CommercialPipelineRunPage>(
    `/commercial-pipeline/runs?page=${page}&limit=${limit}&mode=DRY_RUN`,
  );

export const getCommercialPipelineRun = (id: string) =>
  apiRequest<CommercialPipelineRun>(
    `/commercial-pipeline/runs/${encodeURIComponent(id)}`,
  );
