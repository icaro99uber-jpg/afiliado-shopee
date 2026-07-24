import type { Product, ProductFilters } from '@shopee-auto-affiliate-ai/shared';

export type { ProductFilters };

export type HealthResponse = {
  status: string;
  service: string;
};

export type AnalyticsSnapshot = {
  totalProducts: number;
  totalApprovedProducts: number;
  totalGeneratedCopies: number;
  totalQueuedDispatches: number;
  totalSentDispatches: number;
  totalFailedDispatches: number;
  totalActiveDestinations: number;
};

export type SchedulerStatusValue = 'disabled' | 'registered' | 'not-registered';

export type SchedulerStatus = {
  enabled: boolean;
  status: SchedulerStatusValue;
  jobId: string;
  queue: 'product-pipeline';
  jobName: 'pipeline-product';
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type CopyResponse = {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
};

export type PipelineRunResponse = {
  jobId?: string | number;
  status: 'queued';
};

export type PipelineJobStatus =
  | 'queued'
  | 'waiting'
  | 'delayed'
  | 'active'
  | 'completed'
  | 'failed'
  | 'unknown'
  | string;

export type PipelineJobResponse = {
  status: PipelineJobStatus;
  progress: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
};

export type WhatsAppDestination = {
  id: string;
  name: string;
  destination: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WhatsAppDestinationInput = {
  name: string;
  destination: string;
  active?: boolean;
};

export type WhatsAppGroup = {
  id: string;
  name: string;
  fingerprint: string;
  memberCount: number | null;
  ownerIsParticipant: boolean | null;
  active: boolean;
  available: boolean;
  discoveredAt: string;
  lastSyncedAt: string;
  updatedAt: string | null;
};

export type WhatsAppGroupFilters = {
  active?: boolean;
  available?: boolean;
};

export type WhatsAppGroupSyncReport = {
  discovered: number;
  created: number;
  updated: number;
  unavailable: number;
  active: number;
};

export type WhatsAppDispatchStatus = 'PENDING' | 'SENT' | 'FAILED';

export type DashboardProduct = Product & {
  providerProductId?: string;
  score?: number | null;
  scoreUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type WhatsAppDispatch = {
  id: string;
  productId: string;
  generatedCopyId: string;
  destinationId: string;
  externalMessageId?: string | null;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  generatedCopy?: CopyResponse;
  destination?: Pick<WhatsAppDestination, 'id' | 'name' | 'destination'>;
  product?: DashboardProduct | null;
};

export type DispatchFilters = {
  status?: WhatsAppDispatchStatus | '';
  destinationId?: string;
  productId?: string;
};
