import { describe, expect, it, vi } from 'vitest';

import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  CommercialPipelineConfirmationService,
  commercialConfirmationIds,
} from '../src/commercial-pipeline-confirmation-service';
import type {
  CommercialPipelineRunData,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  GeneratedCopyData,
  GeneratedCopyRecord,
  ShopeeOfferRecord,
  WhatsAppDispatchDetails,
  WhatsAppDispatchCreateData,
  WhatsAppGroupRecord,
} from '../src/repositories';

const now = new Date('2026-07-25T22:00:00.000Z');
const preview =
  'Oferta segura\n\nProduto ficticio\n\nhttps://example.invalid/affiliate/product';

const offer = (
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id: 'product-id',
  source: 'MOCK',
  providerProductId: 'mock-product',
  productName: 'Produto ficticio',
  shopName: 'Loja ficticia',
  categoryIds: ['test'],
  price: '29.90',
  priceMin: '29.90',
  priceMax: '29.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate/product',
  fetchedAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
  score: null,
  scoreUpdatedAt: null,
  ...overrides,
});

const group = (
  overrides: Partial<WhatsAppGroupRecord> = {},
): WhatsAppGroupRecord => ({
  id: 'group-id',
  name: 'Grupo ficticio autorizado',
  destination: 'opaque-internal-destination',
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: 'grp_123456789abc',
  sourceInstanceName: 'affiliate-bot',
  discoveredAt: now,
  lastSyncedAt: now,
  ...overrides,
});

const readyRun = (
  overrides: Partial<CommercialPipelineRunRecord> = {},
): CommercialPipelineRunRecord => ({
  id: 'dry-run-id',
  mode: 'DRY_RUN',
  status: 'COMPLETED',
  productId: 'product-id',
  groupDestinationId: 'group-id',
  productName: 'Produto ficticio',
  productPrice: '29.90',
  groupName: 'Grupo ficticio autorizado',
  groupFingerprint: 'grp_123456789abc',
  score: 95,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['Maior score'],
  copyPreview: preview,
  plannedSubIds: ['whatsapp', 'grp_123456789abc'],
  createdAt: now,
  completedAt: now,
  ...overrides,
});

class MemoryRuns implements CommercialPipelineRunRepository {
  records: CommercialPipelineRunRecord[];

  constructor(record: CommercialPipelineRunRecord) {
    this.records = [record];
  }

  async create(data: CommercialPipelineRunData) {
    const record = { ...data, id: 'created', createdAt: data.createdAt ?? now };
    this.records.push(record);
    return record;
  }

  async update(id: string, data: Partial<CommercialPipelineRunData>) {
    const index = this.records.findIndex((record) => record.id === id);
    this.records[index] = { ...this.records[index], ...data };
    return this.records[index];
  }

  async list() {
    return { items: this.records, total: this.records.length };
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
    const current = await this.findById(id);
    if (
      !current ||
      current.mode !== 'DRY_RUN' ||
      current.status !== 'COMPLETED'
    )
      return null;
    return this.update(id, {
      mode: 'CONFIRMED',
      status: 'STARTED',
      confirmedAt,
      completedAt: null,
      investigationRequired: false,
    });
  }
}

const build = ({
  run = readyRun(),
  currentOffer = offer(),
  groups = [group()],
  alreadySent = false,
  environment = {},
  existingJob = false,
  queueFailure = false,
}: {
  run?: CommercialPipelineRunRecord;
  currentOffer?: ShopeeOfferRecord | null;
  groups?: WhatsAppGroupRecord[];
  alreadySent?: boolean;
  environment?: Partial<{
    groupSendEnabled: boolean;
    safeMode: boolean;
    schedulerEnabled: boolean;
    maximumMessagesPerRun: number;
  }>;
  existingJob?: boolean;
  queueFailure?: boolean;
} = {}) => {
  const runs = new MemoryRuns(run);
  const copies: GeneratedCopyRecord[] = [];
  const dispatches: WhatsAppDispatchDetails[] = [];
  const enqueue = vi.fn(async () => {
    if (queueFailure) throw new Error('redis unavailable');
  });
  const generate = vi.fn(() => preview);
  const service = new CommercialPipelineConfirmationService({
    runs,
    offers: { findOfferById: async () => currentOffer } as never,
    groups: { list: async () => groups } as never,
    generatedCopies: {
      create: async (data: GeneratedCopyData) => {
        const record = { ...data, id: data.id ?? 'copy', createdAt: now };
        copies.push(record);
        return record;
      },
      findById: async (id: string) =>
        copies.find((copy) => copy.id === id) ?? null,
    },
    dispatches: {
      createPending: async (data: WhatsAppDispatchCreateData) => {
        if (dispatches.some((dispatch) => dispatch.id === data.id)) return null;
        const record = {
          ...data,
          id: data.id ?? 'dispatch',
          status: 'PENDING',
          attemptCount: 0,
          generatedCopy: {
            titulo: '',
            mensagem: preview,
            cta: '',
            hashtags: '',
          },
          destination: group(),
        } as WhatsAppDispatchDetails;
        dispatches.push(record);
        return record;
      },
      findByIdWithDetails: async (id: string) =>
        dispatches.find((dispatch) => dispatch.id === id) ?? null,
    } as never,
    deliveryHistory: { wasProductSentToGroup: async () => alreadySent },
    copy: { generate },
    queue: {
      hasJob: async () => existingJob,
      enqueue,
    },
    instanceName: 'affiliate-bot',
    environment: {
      groupSendEnabled: true,
      safeMode: true,
      schedulerEnabled: false,
      maximumMessagesPerRun: 1,
      ...environment,
    },
    logger: { info: vi.fn(), error: vi.fn() },
    clock: () => now,
  });
  return { service, runs, copies, dispatches, enqueue, generate };
};

describe('CommercialPipelineConfirmationService', () => {
  it('confirma uma vez com copy, dispatch e job deterministicos', async () => {
    const state = build();
    const result = await state.service.confirm(
      'dry-run-id',
      COMMERCIAL_CONFIRMATION_TOKEN,
    );
    const ids = commercialConfirmationIds('dry-run-id');
    expect(result).toMatchObject({
      status: 'queued',
      dispatchWasCreated: true,
      jobWasCreated: true,
      messageWasSent: false,
      attemptCount: 0,
    });
    expect(state.copies).toEqual([
      expect.objectContaining({
        id: ids.copyId,
        mensagem: preview,
        titulo: '',
        cta: '',
        hashtags: '',
      }),
    ]);
    expect(state.dispatches[0]).toMatchObject({ id: ids.dispatchId });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.enqueue).toHaveBeenCalledWith(ids.dispatchId, ids.jobId);
    expect(state.runs.records[0]).toMatchObject({
      mode: 'CONFIRMED',
      status: 'STARTED',
      dispatchId: ids.dispatchId,
      jobId: ids.jobId,
      finalStatus: 'PENDING',
    });
  });

  it('rejeita token invalido sem criar estado', async () => {
    const state = build();
    await expect(
      state.service.confirm('dry-run-id', 'CONFIRMAR'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_CONFIRMATION_INVALID',
    });
    expect(state.copies).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('rejeita run inexistente', async () => {
    const state = build();
    await expect(
      state.service.confirm('missing', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_RUN_NOT_READY' });
  });

  it.each(['BLOCKED', 'FAILED', 'STARTED'] as const)(
    'rejeita run %s',
    async (status) => {
      const state = build({ run: readyRun({ status }) });
      await expect(
        state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_RUN_NOT_READY' });
    },
  );

  it('bloqueia run ja confirmado em qualquer estado', async () => {
    const state = build({
      run: readyRun({ mode: 'CONFIRMED', status: 'FAILED' }),
    });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_RUN_ALREADY_CONFIRMED' });
  });

  it.each([
    ['nome', offer({ productName: 'Produto alterado' })],
    ['link', offer({ affiliateLink: 'https://example.invalid/other' })],
    ['expiracao', offer({ offerEndsAt: new Date(now.getTime() - 1) })],
  ])('bloqueia produto alterado por %s', async (_label, currentOffer) => {
    const state = build({ currentOffer });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PRODUCT_CHANGED' });
    expect(state.dispatches).toHaveLength(0);
  });

  it.each([
    [[] as WhatsAppGroupRecord[]],
    [[group({ fingerprint: 'grp_aaaaaaaaaaaa' })]],
    [[group(), group({ id: 'second', fingerprint: 'grp_bbbbbbbbbbbb' })]],
  ])('bloqueia grupo alterado ou ambiguo', async (groups) => {
    const state = build({ groups });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_GROUP_CHANGED' });
  });

  it('bloqueia produto ja enviado ao mesmo grupo', async () => {
    const state = build({ alreadySent: true });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'PRODUCT_ALREADY_SENT' });
  });

  it.each([
    [{ groupSendEnabled: false }, 'GROUP_SEND_DISABLED'],
    [{ safeMode: false }, 'COMMERCIAL_SAFE_MODE_REQUIRED'],
    [{ schedulerEnabled: true }, 'COMMERCIAL_SCHEDULER_BLOCKED'],
    [{ maximumMessagesPerRun: 2 }, 'COMMERCIAL_MESSAGE_LIMIT_INVALID'],
  ] as const)('bloqueia ambiente inseguro', async (environment, code) => {
    const state = build({ environment });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code });
    expect(state.runs.records[0].mode).toBe('DRY_RUN');
  });

  it('bloqueia job anterior antes de reivindicar o run', async () => {
    const state = build({ existingJob: true });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_RUN_ALREADY_CONFIRMED' });
    expect(state.runs.records[0].mode).toBe('DRY_RUN');
  });

  it.each(['PENDING', 'PROCESSING', 'SENT', 'FAILED'] as const)(
    'bloqueia dispatch anterior em estado %s',
    async (status) => {
      const state = build();
      state.dispatches.push({
        id: commercialConfirmationIds('dry-run-id').dispatchId,
        productId: 'product-id',
        generatedCopyId: 'copy-id',
        destinationId: 'group-id',
        status,
        attemptCount: status === 'PENDING' ? 0 : 1,
        generatedCopy: {
          titulo: '',
          mensagem: preview,
          cta: '',
          hashtags: '',
        },
        destination: group(),
      });
      await expect(
        state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_RUN_ALREADY_CONFIRMED' });
      expect(state.enqueue).not.toHaveBeenCalled();
    },
  );

  it('nao repete quando o enfileiramento falha ou fica ambiguo', async () => {
    const state = build({ queueFailure: true });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_DISPATCH_FAILED' });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
    expect(state.runs.records[0]).toMatchObject({
      mode: 'CONFIRMED',
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });
    await expect(
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_RUN_ALREADY_CONFIRMED' });
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });

  it('uma corrida concorrente cria somente um dispatch e um job', async () => {
    const state = build();
    const results = await Promise.allSettled([
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
      state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(state.dispatches).toHaveLength(1);
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });

  it('valida o estado atual sem substituir a copy aprovada', async () => {
    const state = build();
    await state.service.confirm('dry-run-id', COMMERCIAL_CONFIRMATION_TOKEN);
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.copies[0].mensagem).toBe(preview);
  });
});
