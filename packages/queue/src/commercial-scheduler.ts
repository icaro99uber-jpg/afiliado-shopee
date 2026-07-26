export type CommercialAutomationMode = 'preview' | 'send';

export type CommercialAutomationSchedulerConfig = {
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  mode: CommercialAutomationMode;
  jobId: string;
};

export type CommercialAutomationSchedulerStatus =
  'disabled' | 'registered' | 'not-registered';

export type CommercialAutomationSchedulerState = {
  jobId: string;
  status: CommercialAutomationSchedulerStatus;
  cronExpression: string | null;
  timezone: string | null;
  mode: CommercialAutomationMode;
  nextRunAt: string | null;
};

export interface CommercialAutomationScheduler {
  register(
    config: CommercialAutomationSchedulerConfig,
  ): Promise<CommercialAutomationSchedulerState>;
  remove(jobId: string): Promise<CommercialAutomationSchedulerState>;
  getState(
    jobId: string,
    mode: CommercialAutomationMode,
  ): Promise<CommercialAutomationSchedulerState>;
}
