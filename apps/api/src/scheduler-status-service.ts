import {
  DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  JOB_NAMES,
  QUEUE_NAMES,
  type PipelineScheduler,
  type PipelineSchedulerStatus,
} from '@shopee-auto-affiliate-ai/queue';

export type SchedulerPublicStatus = {
  enabled: boolean;
  status: PipelineSchedulerStatus;
  jobId: string;
  queue: typeof QUEUE_NAMES.productPipeline;
  jobName: typeof JOB_NAMES.pipelineProduct;
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
};

export class SchedulerStatusService {
  constructor(
    private readonly scheduler: Pick<PipelineScheduler, 'getState'>,
    private readonly enabled: boolean,
  ) {}

  async getStatus(): Promise<SchedulerPublicStatus> {
    const state = await this.scheduler.getState(
      DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
    );

    return {
      enabled: this.enabled,
      status: this.enabled ? state.status : 'disabled',
      jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      queue: QUEUE_NAMES.productPipeline,
      jobName: JOB_NAMES.pipelineProduct,
      cronExpression: state.cronExpression,
      timezone: state.timezone,
      nextRunAt: state.nextRunAt,
    };
  }
}
