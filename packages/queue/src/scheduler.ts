import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';

type SchedulerConfigBase = {
  jobId: string;
  filters?: ProductFilters;
};

export type SchedulerConfig =
  | (SchedulerConfigBase & {
      enabled: false;
      cronExpression?: string;
      timezone?: string;
    })
  | (SchedulerConfigBase & {
      enabled: true;
      cronExpression: string;
      timezone: string;
    });

export type PipelineSchedulerStatus =
  | 'disabled'
  | 'registered'
  | 'not-registered';

export type PipelineSchedulerState = {
  jobId: string;
  status: PipelineSchedulerStatus;
  cronExpression: string | null;
  timezone: string | null;
  filters?: ProductFilters;
  nextRunAt: string | null;
};

export interface PipelineScheduler {
  register(config: SchedulerConfig): Promise<PipelineSchedulerState>;
  remove(jobId: string): Promise<PipelineSchedulerState>;
  getState(jobId: string): Promise<PipelineSchedulerState>;
}
