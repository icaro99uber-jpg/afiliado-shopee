import type { Product } from '@shopee-auto-affiliate-ai/shared';

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
  createdAt?: Date;
  updatedAt?: Date;
  score?: number | null;
  scoreUpdatedAt?: Date | null;
};

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

export type WhatsAppDispatchStatus = 'PENDING' | 'SENT' | 'FAILED';

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
  markAttemptPending(id: string): Promise<WhatsAppDispatchRecord>;
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
