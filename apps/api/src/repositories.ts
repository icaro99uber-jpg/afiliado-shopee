import type { Product } from '@shopee-auto-affiliate-ai/shared';
import type {
  ShopeeAffiliateOfferSource,
  ShopeeProductOffer,
} from '@shopee-auto-affiliate-ai/providers';

export const APPROVED_PRODUCT_MIN_SCORE = 70;

export type AnalyticsSnapshot = {
  totalProducts: number;
  totalApprovedProducts: number;
  totalGeneratedCopies: number;
  totalQueuedDispatches: number;
  totalSentDispatches: number;
  totalFailedDispatches: number;
  totalActiveDestinations: number;
};

export interface AnalyticsRepository {
  totalProducts(): Promise<number>;
  totalApprovedProducts(): Promise<number>;
  totalGeneratedCopies(): Promise<number>;
  totalQueuedDispatches(): Promise<number>;
  totalSentDispatches(): Promise<number>;
  totalFailedDispatches(): Promise<number>;
  totalActiveDestinations(): Promise<number>;
}

export type ProductLeadData = {
  providerProductId: string;
  nome: string;
  categoria: string;
  preco: number;
  desconto: number;
  nota: number;
  vendidos: number;
  comissao: number;
  loja: string;
  urlImagem: string;
  url?: string | null;
  title: string;
};

export type ProductLeadRecord = ProductLeadData & {
  id: string;
  source?: ShopeeAffiliateOfferSource;
  affiliateLink?: string | null;
  shopId?: string | null;
  categoryIds?: string[];
  commissionAmount?: string | null;
  sellerCommissionRate?: number | null;
  shopeeCommissionRate?: number | null;
  offerStartsAt?: Date | null;
  offerEndsAt?: Date | null;
  fetchedAt?: Date;
  lastSeenAt?: Date;
  unavailableAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  score?: number | null;
  scoreUpdatedAt?: Date | null;
};

export type ShopeeOfferStatus = 'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE';

export type ShopeeOfferRecord = ShopeeProductOffer & {
  id: string;
  score: number | null;
  scoreUpdatedAt: Date | null;
  lastSeenAt: Date;
  unavailableAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ShopeeOfferFilters = {
  source?: ShopeeAffiliateOfferSource;
  status?: ShopeeOfferStatus;
  affiliateLink?: 'present' | 'missing';
  keyword?: string;
  page: number;
  limit: number;
};

export type CommercialOfferCandidateFilters = {
  source: ShopeeAffiliateOfferSource;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscountRate?: number;
  minRating?: number;
  minSales?: number;
  minCommissionRate?: number;
  limit: number;
};

export interface ShopeeOfferRepository {
  findBySourceAndProviderProductId(
    source: ShopeeAffiliateOfferSource,
    providerProductId: string,
  ): Promise<Pick<ShopeeOfferRecord, 'id'> | null>;
  createOffer(offer: ShopeeProductOffer): Promise<ShopeeOfferRecord>;
  updateOffer(
    id: string,
    offer: ShopeeProductOffer,
  ): Promise<ShopeeOfferRecord>;
  findOfferById(id: string): Promise<ShopeeOfferRecord | null>;
  listOffers(
    filters: ShopeeOfferFilters,
  ): Promise<{ items: ShopeeOfferRecord[]; total: number }>;
  listCommercialCandidates(
    filters: CommercialOfferCandidateFilters,
  ): Promise<ShopeeOfferRecord[]>;
}

export type CommercialPipelineRunMode = 'DRY_RUN' | 'CONFIRMED';
export type CommercialPipelineRunStatus =
  'STARTED' | 'COMPLETED' | 'BLOCKED' | 'FAILED';
export type CommercialPipelineFinalStatus =
  'PENDING' | 'SENT' | 'FAILED' | 'AMBIGUOUS';

export type CommercialPipelineRejectionCode =
  | 'MISSING_AFFILIATE_LINK'
  | 'INVALID_AFFILIATE_LINK'
  | 'OFFER_EXPIRED'
  | 'OFFER_UNAVAILABLE'
  | 'OFFER_NOT_STARTED'
  | 'INVALID_PRODUCT_NAME'
  | 'INVALID_PRICE'
  | 'INVALID_IMAGE'
  | 'INVALID_SHOP'
  | 'INVALID_RATING'
  | 'INVALID_SALES'
  | 'INVALID_COMMISSION_RATE'
  | 'SCORE_BELOW_MINIMUM'
  | 'ALREADY_SENT_TO_GROUP';

export type CommercialPipelineRunData = {
  mode: CommercialPipelineRunMode;
  status: CommercialPipelineRunStatus;
  productId?: string | null;
  groupDestinationId?: string | null;
  productName?: string | null;
  productPrice?: string | null;
  groupName?: string | null;
  groupFingerprint?: string | null;
  score?: number | null;
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Record<string, number>;
  selectionReasons: string[];
  copyPreview?: string | null;
  plannedSubIds: string[];
  dispatchId?: string | null;
  jobId?: string | null;
  confirmedAt?: Date | null;
  finalStatus?: CommercialPipelineFinalStatus | null;
  investigationRequired?: boolean;
  failureCode?: string | null;
  createdAt?: Date;
  completedAt?: Date | null;
};

export type CommercialPipelineRunRecord = CommercialPipelineRunData & {
  id: string;
  createdAt: Date;
};

export type CommercialPipelineRunFilters = {
  status?: CommercialPipelineRunStatus;
  mode?: CommercialPipelineRunMode;
  productId?: string;
  page: number;
  limit: number;
};

export interface CommercialPipelineRunRepository {
  create(data: CommercialPipelineRunData): Promise<CommercialPipelineRunRecord>;
  update(
    id: string,
    data: Partial<CommercialPipelineRunData>,
  ): Promise<CommercialPipelineRunRecord>;
  list(
    filters: CommercialPipelineRunFilters,
  ): Promise<{ items: CommercialPipelineRunRecord[]; total: number }>;
  findById(id: string): Promise<CommercialPipelineRunRecord | null>;
  findByDispatchId(
    dispatchId: string,
  ): Promise<CommercialPipelineRunRecord | null>;
}

export interface CommercialDeliveryHistoryRepository {
  wasProductSentToGroup(productId: string, groupId: string): Promise<boolean>;
}

export type CommercialDispatchOutboxStatus =
  'PENDING' | 'PUBLISHED' | 'AMBIGUOUS';

export type CommercialDispatchOutboxRecord = {
  id: string;
  commercialRunId: string;
  dispatchId: string;
  jobId: string;
  status: CommercialDispatchOutboxStatus;
  failureCode: string | null;
  createdAt: Date;
  publishedAt: Date | null;
};

export type CommercialDispatchOutboxFilters = {
  status?: CommercialDispatchOutboxStatus;
  page: number;
  limit: number;
};

export type CommercialDispatchOutboxPublicationContext = {
  outbox: CommercialDispatchOutboxRecord;
  run: Pick<
    CommercialPipelineRunRecord,
    | 'id'
    | 'mode'
    | 'status'
    | 'dispatchId'
    | 'jobId'
    | 'finalStatus'
    | 'investigationRequired'
  >;
  dispatch: Pick<WhatsAppDispatchRecord, 'id' | 'status' | 'attemptCount'>;
};

export type CommercialConfirmationPersistenceInput = {
  outboxId: string;
  runId: string;
  confirmedAt: Date;
  copy: GeneratedCopyData & { id: string };
  dispatch: WhatsAppDispatchCreateData & { id: string };
  jobId: string;
};

export interface CommercialDispatchOutboxRepository {
  createPendingConfirmation(
    input: CommercialConfirmationPersistenceInput,
  ): Promise<CommercialDispatchOutboxRecord | null>;
  list(
    filters: CommercialDispatchOutboxFilters,
  ): Promise<{ items: CommercialDispatchOutboxRecord[]; total: number }>;
  findById(id: string): Promise<CommercialDispatchOutboxRecord | null>;
  findPublicationContext(
    id: string,
  ): Promise<CommercialDispatchOutboxPublicationContext | null>;
  markPublished(
    id: string,
    publishedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null>;
  markAmbiguous(
    id: string,
    failureCode: string,
    completedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null>;
}

export type CommercialAutomationSettingsRecord = {
  paused: boolean;
  pausedAt: Date | null;
  resumedAt: Date | null;
  updatedAt: Date;
};

export interface CommercialAutomationSettingsRepository {
  get(): Promise<CommercialAutomationSettingsRecord | null>;
  getOrCreate(now: Date): Promise<CommercialAutomationSettingsRecord>;
  setPaused(
    paused: boolean,
    now: Date,
  ): Promise<CommercialAutomationSettingsRecord>;
}

export type CommercialAutomationHistorySnapshot = {
  globalSentToday: number;
  groupSentToday: number;
  lastSentAt: Date | null;
};

export interface CommercialAutomationHistoryRepository {
  getSnapshot(input: {
    groupId?: string;
    dayStartsAt: Date;
    dayEndsAt: Date;
  }): Promise<CommercialAutomationHistorySnapshot>;
  hasAmbiguousCommercialExecution(): Promise<boolean>;
  hasActiveCommercialExecution(
    now: Date,
    excludedExecutionId?: string,
  ): Promise<boolean>;
  hasStaleCommercialExecution(now: Date): Promise<boolean>;
}

export type CommercialAutomationExecutionMode = 'PREVIEW' | 'SEND';
export type CommercialAutomationExecutionStatus =
  'STARTED' | 'BLOCKED' | 'PREVIEW_READY' | 'QUEUED' | 'FAILED' | 'AMBIGUOUS';

export type CommercialAutomationExecutionRecord = {
  id: string;
  schedulerJobId: string;
  bullMqJobId: string | null;
  activeKey: string | null;
  ownerId: string | null;
  heartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  mode: CommercialAutomationExecutionMode;
  status: CommercialAutomationExecutionStatus;
  reasons: string[];
  commercialRunId: string | null;
  failureCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type CommercialAutomationExecutionOwnership = {
  executionId: string;
  ownerId: string;
};

export type CommercialAutomationExecutionRecoveryContext = {
  execution: CommercialAutomationExecutionRecord;
  run:
    | (Pick<
        CommercialPipelineRunRecord,
        | 'id'
        | 'mode'
        | 'dispatchId'
        | 'jobId'
        | 'finalStatus'
        | 'investigationRequired'
      > & {
        dispatch: Pick<
          WhatsAppDispatchRecord,
          'id' | 'status' | 'attemptCount'
        > | null;
        outbox: CommercialDispatchOutboxRecord | null;
      })
    | null;
};

export type StartCommercialAutomationExecutionResult =
  | {
      outcome: 'created';
      execution: CommercialAutomationExecutionRecord;
      ownership: CommercialAutomationExecutionOwnership;
    }
  | { outcome: 'existing'; execution: CommercialAutomationExecutionRecord }
  | { outcome: 'concurrent'; stale: boolean };

export interface CommercialAutomationExecutionRepository {
  start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionMode;
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
  }): Promise<StartCommercialAutomationExecutionResult>;
  createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionMode;
    reasons: string[];
    completedAt: Date;
  }): Promise<CommercialAutomationExecutionRecord>;
  heartbeat(
    ownership: CommercialAutomationExecutionOwnership,
    input: { heartbeatAt: Date; leaseExpiresAt: Date },
  ): Promise<void>;
  finish(
    ownership: CommercialAutomationExecutionOwnership,
    input: {
      status: Exclude<CommercialAutomationExecutionStatus, 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ): Promise<CommercialAutomationExecutionRecord>;
  findRecoveryContext(
    id: string,
  ): Promise<CommercialAutomationExecutionRecoveryContext | null>;
  recoverStale(
    id: string,
    input: {
      status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
      failureCode?: string;
      completedAt: Date;
    },
  ): Promise<CommercialAutomationExecutionRecord>;
  list(input: {
    page: number;
    limit: number;
  }): Promise<{ items: CommercialAutomationExecutionRecord[]; total: number }>;
  findById(id: string): Promise<CommercialAutomationExecutionRecord | null>;
}

export type CouponSource = 'MANUAL' | 'OFFICIAL';
export type CouponDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export type CouponData = {
  source: CouponSource;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minPurchase?: string | null;
  maxDiscount?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active: boolean;
  shopId?: string | null;
  productId?: string | null;
  terms?: string | null;
  lastValidatedAt?: Date | null;
};

export type CouponRecord = CouponData & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface CouponRepository {
  create(data: CouponData): Promise<CouponRecord>;
  list(): Promise<CouponRecord[]>;
  findById(id: string): Promise<CouponRecord | null>;
  update(id: string, data: Partial<CouponData>): Promise<CouponRecord | null>;
  delete(id: string): Promise<boolean>;
}

export type GeneratedCopyData = {
  id?: string;
  productId: string;
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
};

export type GeneratedCopyRecord = GeneratedCopyData & {
  id: string;
  createdAt?: Date;
};

export type WhatsAppDestinationData = {
  id?: string;
  name: string;
  destination: string;
  active: boolean;
  type?: 'INDIVIDUAL' | 'GROUP';
  available?: boolean;
  fingerprint?: string | null;
  sourceInstanceName?: string | null;
  memberCount?: number | null;
  ownerIsParticipant?: boolean | null;
  discoveredAt?: Date | null;
  lastSyncedAt?: Date | null;
};

export type WhatsAppDestinationUpdate = Partial<WhatsAppDestinationData>;

export type WhatsAppDestinationRecord = WhatsAppDestinationData & {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type WhatsAppGroupRecord = WhatsAppDestinationRecord & {
  type: 'GROUP';
  available: boolean;
  fingerprint: string;
  sourceInstanceName: string;
  discoveredAt: Date;
  lastSyncedAt: Date;
};

export type WhatsAppGroupCreateData = Omit<
  WhatsAppGroupRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

export type WhatsAppGroupUpdate = Partial<
  Pick<
    WhatsAppGroupRecord,
    | 'name'
    | 'active'
    | 'available'
    | 'fingerprint'
    | 'memberCount'
    | 'ownerIsParticipant'
    | 'lastSyncedAt'
  >
>;

export type WhatsAppGroupFilters = {
  active?: boolean;
  available?: boolean;
};

export type WhatsAppDispatchStatus =
  'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export type WhatsAppDispatchCreateData = {
  id?: string;
  productId: string;
  generatedCopyId: string;
  destinationId: string;
};

export type WhatsAppDispatchFilters = {
  status?: string;
  destinationId?: string;
  productId?: string;
};

export type WhatsAppDispatchRecord = WhatsAppDispatchCreateData & {
  id: string;
  externalMessageId?: string | null;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
  errorMessage?: string | null;
  sentAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type WhatsAppDispatchDetails = WhatsAppDispatchRecord & {
  generatedCopy: Pick<
    GeneratedCopyRecord,
    'titulo' | 'mensagem' | 'cta' | 'hashtags'
  >;
  destination: Pick<
    WhatsAppDestinationRecord,
    | 'destination'
    | 'type'
    | 'active'
    | 'available'
    | 'fingerprint'
    | 'sourceInstanceName'
  >;
  product?: Pick<ProductLeadRecord, 'comissao'> | null;
};

export interface ProductRepository {
  findById(id: string): Promise<ProductLeadRecord | null>;
  findByProviderProductId(
    providerProductId: string,
  ): Promise<Pick<ProductLeadRecord, 'id'> | null>;
  create(data: ProductLeadData): Promise<ProductLeadRecord>;
  updateByProviderProductId(
    providerProductId: string,
    data: ProductLeadData,
  ): Promise<ProductLeadRecord>;
  listForScoring(): Promise<ProductLeadRecord[]>;
  updateScore(
    id: string,
    score: number,
    scoreUpdatedAt: Date,
  ): Promise<ProductLeadRecord>;
  listApproved(minScore: number): Promise<ProductLeadRecord[]>;
}

export interface GeneratedCopyRepository {
  create(data: GeneratedCopyData): Promise<GeneratedCopyRecord>;
  findById(id: string): Promise<GeneratedCopyRecord | null>;
}

export interface WhatsAppDestinationRepository {
  findById(id: string): Promise<WhatsAppDestinationRecord | null>;
  listActive(): Promise<WhatsAppDestinationRecord[]>;
  create(data: WhatsAppDestinationData): Promise<WhatsAppDestinationRecord>;
  list(): Promise<WhatsAppDestinationRecord[]>;
  update(
    id: string,
    data: WhatsAppDestinationUpdate,
  ): Promise<WhatsAppDestinationRecord | null>;
}

export interface WhatsAppGroupDirectoryRepository {
  findById(id: string): Promise<WhatsAppGroupRecord | null>;
  findByExternalGroupId(
    sourceInstanceName: string,
    externalGroupId: string,
  ): Promise<WhatsAppGroupRecord | null>;
  listByInstance(sourceInstanceName: string): Promise<WhatsAppGroupRecord[]>;
  list(
    sourceInstanceName: string,
    filters?: WhatsAppGroupFilters,
  ): Promise<WhatsAppGroupRecord[]>;
  create(data: WhatsAppGroupCreateData): Promise<WhatsAppGroupRecord>;
  update(
    id: string,
    data: WhatsAppGroupUpdate,
  ): Promise<WhatsAppGroupRecord | null>;
}

export interface WhatsAppDispatchRepository {
  createPending(
    data: WhatsAppDispatchCreateData,
  ): Promise<WhatsAppDispatchRecord | null>;
  findByIdForSending(id: string): Promise<WhatsAppDispatchDetails | null>;
  findByIdWithDetails(id: string): Promise<WhatsAppDispatchDetails | null>;
  list(filters: WhatsAppDispatchFilters): Promise<WhatsAppDispatchDetails[]>;
  markAttemptPending(id: string): Promise<boolean>;
  markSent(
    id: string,
    data: { externalMessageId: string; sentAt: Date },
  ): Promise<WhatsAppDispatchRecord>;
  markFailed(id: string, errorMessage: string): Promise<WhatsAppDispatchRecord>;
}

export const toProductLeadData = (produto: Product): ProductLeadData => ({
  providerProductId: produto.id,
  nome: produto.nome,
  categoria: produto.categoria,
  preco: produto.preco,
  desconto: produto.desconto,
  nota: produto.nota,
  vendidos: produto.vendidos,
  comissao: produto.comissao,
  loja: produto.loja,
  urlImagem: produto.urlImagem,
  url: produto.url,
  title: produto.nome,
});
