import { describe, expect, it } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { CommercialCopyService } from '../src/commercial-copy-service';
import { CommercialPipelineService } from '../src/commercial-pipeline-service';
import type {
  CommercialPipelineRunData,
  CommercialPipelineRunFilters,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  ShopeeOfferRecord,
  WhatsAppGroupRecord,
} from '../src/repositories';

const now = new Date('2026-07-25T12:00:00.000Z');

const offer = (
  id: string,
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id,
  source: 'MOCK',
  providerProductId: id,
  productName: `Produto ${id}`,
  shopName: 'Loja ficticia',
  categoryIds: ['cat-1'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: `https://example.invalid/affiliate/${id}`,
  offerStartsAt: new Date('2026-01-01T00:00:00.000Z'),
  offerEndsAt: new Date('2099-01-01T00:00:00.000Z'),
  fetchedAt: now,
  lastSeenAt: now,
  score: null,
  scoreUpdatedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const group = (
  id = 'group-1',
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id,
  name: 'Grupo ficticio autorizado',
  destination: 'internal-value-never-returned',
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: 'grp_123456789abc',
  sourceInstanceName: 'affiliate-bot',
  discoveredAt: now,
  lastSyncedAt: now,
  ...overrides,
});

class MemoryRuns implements CommercialPipelineRunRepository {
  records: CommercialPipelineRunRecord[] = [];

  async create(data: CommercialPipelineRunData) {
    const record = {
      ...data,
      id: `run-${this.records.length + 1}`,
      createdAt: data.createdAt ?? now,
    };
    this.records.push(record);
    return record;
  }

  async update(id: string, data: Partial<CommercialPipelineRunData>) {
    const index = this.records.findIndex((record) => record.id === id);
    this.records[index] = { ...this.records[index], ...data };
    return this.records[index];
  }

  async list(filters: CommercialPipelineRunFilters) {
    const items = this.records.filter(
      (record) =>
        (!filters.status || record.status === filters.status) &&
        (!filters.mode || record.mode === filters.mode) &&
        (!filters.productId || record.productId === filters.productId),
    );
    return { items, total: items.length };
  }

  async findById(id: string) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByDispatchId(dispatchId: string) {
    return (
      this.records.find((record) => record.dispatchId === dispatchId) ?? null
    );
  }

  async claimConfirmation(id: string, confirmedAt: Date) {
    const record = await this.findById(id);
    if (!record || record.mode !== 'DRY_RUN' || record.status !== 'COMPLETED')
      return null;
    return this.update(id, {
      mode: 'CONFIRMED',
      status: 'STARTED',
      confirmedAt,
      completedAt: null,
    });
  }
}

const build = ({
  candidates = [offer('product-a')],
  groups = [group()],
  scores = {},
  sent = new Set<string>(),
  maximumCopyLength = 1000,
}: {
  candidates?: ShopeeOfferRecord[];
  groups?: WhatsAppGroupRecord[];
  scores?: Record<string, number>;
  sent?: Set<string>;
  maximumCopyLength?: number;
} = {}) => {
  const runs = new MemoryRuns();
  const service = new CommercialPipelineService({
    offers: {
      listCommercialCandidates: async () => candidates,
    } as never,
    groups: {
      list: async () => groups,
    } as never,
    score: {
      calculate: (product) => scores[product.id] ?? 80,
    },
    copy: new CommercialCopyService(maximumCopyLength),
    runs,
    deliveryHistory: {
      wasProductSentToGroup: async (productId, groupId) =>
        sent.has(`${productId}:${groupId}`),
    },
    instanceName: 'affiliate-bot',
    subIdPrefix: 'whatsapp',
    logger: { info: () => undefined, error: () => undefined },
    clock: () => new Date(now),
  });
  return { service, runs };
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error('Expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
};

describe('CommercialPipelineService', () => {
  it('escolhe o maior score', async () => {
    const { service } = build({
      candidates: [offer('a'), offer('b')],
      scores: { a: 71, b: 92 },
    });
    expect((await service.dryRun()).selectedProduct.id).toBe('b');
  });

  it('desempata por commissionRate', async () => {
    const { service } = build({
      candidates: [
        offer('a', { commissionRate: 10 }),
        offer('b', { commissionRate: 11 }),
      ],
    });
    expect((await service.dryRun()).selectedProduct.id).toBe('b');
  });

  it('desempata por sales', async () => {
    const { service } = build({
      candidates: [offer('a', { sales: 10 }), offer('b', { sales: 20 })],
    });
    expect((await service.dryRun()).selectedProduct.id).toBe('b');
  });

  it('desempata por discountRate', async () => {
    const { service } = build({
      candidates: [
        offer('a', { discountRate: 10 }),
        offer('b', { discountRate: 20 }),
      ],
    });
    expect((await service.dryRun()).selectedProduct.id).toBe('b');
  });

  it('desempata por rating', async () => {
    const { service } = build({
      candidates: [offer('a', { rating: 4 }), offer('b', { rating: 5 })],
    });
    expect((await service.dryRun()).selectedProduct.id).toBe('b');
  });

  it('usa providerProductId como desempate final deterministico', async () => {
    const { service } = build({
      candidates: [offer('b'), offer('a')],
    });
    expect((await service.dryRun()).selectedProduct.id).toBe('a');
  });

  it('rejeita produto sem affiliateLink', async () => {
    const { service, runs } = build({
      candidates: [offer('a', { affiliateLink: undefined })],
    });
    await expectCode(service.dryRun(), 'NO_ELIGIBLE_PRODUCT');
    expect(runs.records[0].rejectionSummary).toEqual({
      MISSING_AFFILIATE_LINK: 1,
    });
  });

  it('rejeita produto expirado', async () => {
    const { service, runs } = build({
      candidates: [
        offer('a', { offerEndsAt: new Date('2026-07-24T00:00:00.000Z') }),
      ],
    });
    await expectCode(service.dryRun(), 'NO_ELIGIBLE_PRODUCT');
    expect(runs.records[0].rejectionSummary.OFFER_EXPIRED).toBe(1);
  });

  it('rejeita produto indisponivel', async () => {
    const { service, runs } = build({
      candidates: [offer('a', { unavailableAt: now })],
    });
    await expectCode(service.dryRun(), 'NO_ELIGIBLE_PRODUCT');
    expect(runs.records[0].rejectionSummary.OFFER_UNAVAILABLE).toBe(1);
  });

  it('rejeita produto abaixo do score minimo', async () => {
    const { service, runs } = build({ scores: { 'product-a': 69 } });
    await expectCode(service.dryRun(), 'NO_ELIGIBLE_PRODUCT');
    expect(runs.records[0].rejectionSummary.SCORE_BELOW_MINIMUM).toBe(1);
  });

  it('rejeita produto ja enviado e escolhe o proximo', async () => {
    const { service } = build({
      candidates: [offer('a'), offer('b')],
      sent: new Set(['a:group-1']),
    });
    const result = await service.dryRun();
    expect(result.selectedProduct.id).toBe('b');
    expect(result.rejectionSummary.ALREADY_SENT_TO_GROUP).toBe(1);
  });

  it('falha quando todos os produtos ja foram enviados', async () => {
    const { service } = build({
      sent: new Set(['product-a:group-1']),
    });
    await expectCode(service.dryRun(), 'PRODUCT_ALREADY_SENT');
  });

  it('falha com zero produtos elegiveis', async () => {
    await expectCode(
      build({ candidates: [] }).service.dryRun(),
      'NO_ELIGIBLE_PRODUCT',
    );
  });

  it('falha com zero grupos autorizados', async () => {
    await expectCode(
      build({ groups: [] }).service.dryRun(),
      'NO_AUTHORIZED_GROUP',
    );
  });

  it('falha com multiplos grupos autorizados', async () => {
    await expectCode(
      build({ groups: [group('one'), group('two')] }).service.dryRun(),
      'MULTIPLE_AUTHORIZED_GROUPS',
    );
  });

  it('ignora grupo indisponivel', async () => {
    await expectCode(
      build({ groups: [group('one', { available: false })] }).service.dryRun(),
      'NO_AUTHORIZED_GROUP',
    );
  });

  it('ignora grupo inativo', async () => {
    await expectCode(
      build({ groups: [group('one', { active: false })] }).service.dryRun(),
      'NO_AUTHORIZED_GROUP',
    );
  });

  it('copy nao contem comissao nem score', async () => {
    const result = await build().service.dryRun();
    expect(result.copyPreview.toLocaleLowerCase()).not.toContain('comiss');
    expect(result.copyPreview.toLocaleLowerCase()).not.toContain('score');
  });

  it('copy nao contem cupom', async () => {
    const result = await build().service.dryRun();
    expect(result.copyPreview.toLocaleLowerCase()).not.toContain('cupom');
  });

  it('copy contem o affiliateLink persistido', async () => {
    const result = await build().service.dryRun();
    expect(result.copyPreview).toContain(
      'https://example.invalid/affiliate/product-a',
    );
  });

  it('omite desconto zero', async () => {
    const result = await build({
      candidates: [offer('a', { discountRate: 0 })],
    }).service.dryRun();
    expect(result.copyPreview).not.toContain('% de desconto');
  });

  it('formata preco em pt-BR', async () => {
    expect((await build().service.dryRun()).copyPreview).toContain('R$ 99,90');
  });

  it('planeja Sub_ids sem alterar o link', async () => {
    const result = await build().service.dryRun({ campaign: 'Teste Local' });
    expect(result.plannedSubIds).toEqual([
      'whatsapp',
      'whatsapp',
      'grp_123456789abc',
      'teste-local',
      '2026-07-25',
    ]);
    expect(result.copyPreview).toContain(
      'https://example.invalid/affiliate/product-a',
    );
  });

  it.each([
    ['dispatch', 'dispatchWillBeCreated'],
    ['job', 'jobWillBeCreated'],
    ['Evolution', 'messageWillBeSent'],
    ['WhatsApp', 'messageWillBeSent'],
  ] as const)('dry-run nao cria nem chama %s', async (_, field) => {
    expect((await build().service.dryRun())[field]).toBe(false);
  });

  it('produz resultado deterministico', async () => {
    const first = await build({
      candidates: [offer('b'), offer('a')],
    }).service.dryRun();
    const second = await build({
      candidates: [offer('b'), offer('a')],
    }).service.dryRun();
    expect({ ...first, runId: undefined }).toEqual({
      ...second,
      runId: undefined,
    });
  });

  it('persiste o historico concluido', async () => {
    const { service, runs } = build();
    await service.dryRun();
    expect(runs.records[0]).toMatchObject({
      mode: 'DRY_RUN',
      status: 'COMPLETED',
      productId: 'product-a',
      groupFingerprint: 'grp_123456789abc',
      failureCode: null,
    });
  });

  it('registra falha com codigo sanitizado', async () => {
    const { service, runs } = build({ groups: [] });
    await expectCode(service.dryRun(), 'NO_AUTHORIZED_GROUP');
    expect(runs.records[0]).toMatchObject({
      status: 'BLOCKED',
      failureCode: 'NO_AUTHORIZED_GROUP',
    });
    expect(JSON.stringify(runs.records[0])).not.toContain('@g.us');
  });
});
