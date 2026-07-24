import type { Product } from '@shopee-auto-affiliate-ai/shared';

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
  name: string;
  destination: string;
  active: boolean;
};

export type WhatsAppDestinationUpdate = Partial<WhatsAppDestinationData>;

export type WhatsAppDestinationRecord = WhatsAppDestinationData & {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type WhatsAppDispatchStatus = 'PENDING' | 'SENT' | 'FAILED';

export type WhatsAppDispatchCreateData = {
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
  destination: Pick<WhatsAppDestinationRecord, 'destination'>;
  product?: Pick<ProductLeadRecord, 'comissao'> | null;
};

export interface ProductRepository {
  findById(id: string): Promise<ProductLeadRecord | null>;
  findByProviderProductId(providerProductId: string): Promise<Pick<ProductLeadRecord, 'id'> | null>;
  create(data: ProductLeadData): Promise<ProductLeadRecord>;
  updateByProviderProductId(providerProductId: string, data: ProductLeadData): Promise<ProductLeadRecord>;
  listForScoring(): Promise<ProductLeadRecord[]>;
  updateScore(id: string, score: number, scoreUpdatedAt: Date): Promise<ProductLeadRecord>;
  listApproved(minScore: number): Promise<ProductLeadRecord[]>;
}

export interface GeneratedCopyRepository {
  create(data: GeneratedCopyData): Promise<GeneratedCopyRecord>;
  findById(id: string): Promise<GeneratedCopyRecord | null>;
}

export interface WhatsAppDestinationRepository {
  listActive(): Promise<WhatsAppDestinationRecord[]>;
  create(data: WhatsAppDestinationData): Promise<WhatsAppDestinationRecord>;
  list(): Promise<WhatsAppDestinationRecord[]>;
  update(id: string, data: WhatsAppDestinationUpdate): Promise<WhatsAppDestinationRecord | null>;
}

export interface WhatsAppDispatchRepository {
  createPending(data: WhatsAppDispatchCreateData): Promise<WhatsAppDispatchRecord | null>;
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
