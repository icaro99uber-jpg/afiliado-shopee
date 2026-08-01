import { describe, expect, it, vi } from 'vitest';

import {
  CommercialAiCopyProviderError,
  type CommercialAiCopyProvider,
} from '../src/commercial-ai-copy-provider';
import { CommercialPromotionCopyGenerationService } from '../src/commercial-promotion-copy-generation-service';
import type {
  CommercialAiCopyClaimInput,
  CommercialAiCopyCompletionInput,
  CommercialCopyGenerationAttemptRecord,
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  GeneratedCopyRecord,
} from '../src/repositories';

const now = new Date('2026-08-01T12:00:00.000Z');
const affiliateLink = 'https://example.invalid/affiliate/internal';

const contextFixture = (): CommercialPromotionCopyContext => ({
  candidate: {
    id: 'candidate-internal',
    campaignId: 'campaign-internal',
    productId: 'product-internal',
    snapshotId: 'snapshot-internal',
    generatedCopyId: null,
    status: 'QUEUED',
    rankPosition: 1,
    commercialScore: 82,
    scorePolicyVersion: 'official-v2',
    minimumScoreUsed: 60,
    scoreBreakdown: {
      policyVersion: 'official-v2',
      rawTotal: 82,
      finalScore: 82,
      components: { commission: 20, rating: 20, sales: 20, discount: 22 },
    },
    promotionSignals: ['PRICE_DROP', 'CURRENT_DISCOUNT'],
    priceDropPercent: '12.5',
    queuedAt: now,
    lastEvaluatedAt: now,
    expiresAt: new Date('2026-08-02T12:00:00.000Z'),
    dedupeUntil: null,
    blockedReason: null,
    createdAt: now,
    updatedAt: now,
  },
  campaign: {
    id: 'campaign-internal',
    name: 'Campanha local',
    logicalGroupFingerprint: 'grp_internal',
    anchorDestinationId: null,
    nicheId: 'niche-internal',
    active: true,
    cadenceMinutes: 15,
    timezone: 'America/Sao_Paulo',
    allowedStartTime: '07:00',
    allowedEndTime: '22:00',
    dailyLimit: 10,
    queueTargetSize: 40,
    dedupeDays: 30,
    niche: { id: 'niche-internal', name: 'Casa', slug: 'casa', active: true },
    anchorDestination: null,
    createdAt: now,
    updatedAt: now,
  },
  niche: {
    id: 'niche-internal',
    name: 'Casa',
    slug: 'casa',
    active: true,
    categoryIds: [],
    includeKeywords: [],
    excludeKeywords: [],
    minPrice: null,
    maxPrice: null,
    minDiscountRate: 5,
    minRating: 0,
    minSales: 0,
    minCommissionRate: 0,
    minimumScore: 60,
    createdAt: now,
    updatedAt: now,
  },
  product: {
    id: 'product-internal',
    source: 'OFFICIAL',
    productName: 'Produto verificado',
    shopName: 'Loja verificada',
    price: '99.90',
    discountRate: 20,
    rating: 4.8,
    sales: 500,
    affiliateLink,
    offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
    unavailableAt: null,
    commercialSnapshotRevision: 2,
    commercialSnapshotFingerprint: 'snapshot-fingerprint',
    updatedAt: now,
  },
  snapshot: {
    id: 'snapshot-internal',
    productId: 'product-internal',
    revision: 2,
    fingerprint: 'snapshot-fingerprint',
    price: '99.90',
    priceMin: null,
    priceMax: null,
    discountRate: 20,
    commissionRate: 10,
    observedRating: 4.8,
    observedSales: 500,
    offerStartsAt: null,
    offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
    unavailableAt: null,
    capturedAt: now,
    createdAt: now,
  },
  previousSnapshot: null,
});

class MemoryCopyRepository implements CommercialPromotionCopyRepository {
  context: CommercialPromotionCopyContext | null = contextFixture();
  copies = new Map<string, GeneratedCopyRecord>();
  attempts = new Map<string, CommercialCopyGenerationAttemptRecord>();
  completionFailure: string | null = null;

  async loadContext() {
    return this.context;
  }
  async findCopyByInputFingerprint(fingerprint: string) {
    return this.copies.get(fingerprint) ?? null;
  }
  async findAttemptByInputFingerprint(fingerprint: string) {
    return this.attempts.get(fingerprint) ?? null;
  }
  async claim(input: CommercialAiCopyClaimInput) {
    if (this.attempts.has(input.inputFingerprint)) return false;
    this.attempts.set(input.inputFingerprint, {
      id: 'attempt-internal',
      candidateId: input.candidateId,
      snapshotId: input.snapshotId,
      inputFingerprint: input.inputFingerprint,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      validationVersion: input.validationVersion,
      startedAt: input.startedAt,
      status: 'STARTED',
      generatedCopyId: null,
      failureCode: null,
      requestMayHaveStarted: false,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      completedAt: null,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    });
    return true;
  }
  async linkCachedCopy(
    input: Parameters<CommercialPromotionCopyRepository['linkCachedCopy']>[0],
  ) {
    if (!this.context) return false;
    this.context.candidate.status = 'COPY_READY';
    this.context.candidate.generatedCopyId = input.copyId;
    return true;
  }
  async complete(input: CommercialAiCopyCompletionInput) {
    const attempt = this.attempts.get(input.inputFingerprint)!;
    if (this.completionFailure) {
      attempt.status = 'FAILED';
      attempt.failureCode = this.completionFailure;
      attempt.completedAt = input.completedAt;
      return { completed: false as const, failureCode: this.completionFailure };
    }
    const copy: GeneratedCopyRecord = {
      id: 'copy-internal',
      ...input.copy,
      createdAt: input.completedAt,
    };
    this.copies.set(input.inputFingerprint, copy);
    attempt.status = 'SUCCEEDED';
    attempt.generatedCopyId = copy.id;
    attempt.completedAt = input.completedAt;
    if (this.context) {
      this.context.candidate.status = 'COPY_READY';
      this.context.candidate.generatedCopyId = copy.id;
    }
    return { completed: true as const, copy };
  }
  async markAttemptTerminal(input: {
    inputFingerprint: string;
    status: 'FAILED' | 'AMBIGUOUS';
    failureCode: string;
    requestMayHaveStarted: boolean;
    completedAt: Date;
  }) {
    const attempt = this.attempts.get(input.inputFingerprint);
    if (!attempt || attempt.status !== 'STARTED') return false;
    Object.assign(attempt, input);
    return true;
  }
  async findCopyForCandidate() {
    if (!this.context?.candidate.generatedCopyId) return null;
    const copy = [...this.copies.values()].find(
      ({ id }) => id === this.context?.candidate.generatedCopyId,
    );
    return copy
      ? {
          candidate: this.context.candidate,
          copy,
          snapshotRevision: this.context.snapshot.revision,
        }
      : null;
  }
}

const validProvider = (): CommercialAiCopyProvider => ({
  generate: vi.fn().mockResolvedValue({
    output: {
      headline: 'Oferta confiável',
      body: 'Uma escolha prática para sua rotina.',
      cta: 'Confira os detalhes',
      hashtags: ['#Oferta'],
    },
    provider: 'openai',
    model: 'selected-model',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  }),
});

const service = (
  repository: MemoryCopyRepository,
  provider: CommercialAiCopyProvider = validProvider(),
) =>
  new CommercialPromotionCopyGenerationService({
    repository,
    provider,
    config: {
      enabled: true,
      provider: 'openai',
      model: 'selected-model',
      apiKeyConfigured: true,
      timeoutMs: 30000,
      maxOutputTokens: 300,
      maximumCopyLength: 1000,
    },
    clock: () => now,
  });

describe('CommercialPromotionCopyGenerationService', () => {
  it('aprova preflight configurado sem construir ou chamar provider', () => {
    const repository = new MemoryCopyRepository();
    const copyService = new CommercialPromotionCopyGenerationService({
      repository,
      config: {
        enabled: true,
        provider: 'openai',
        model: 'selected-model',
        apiKeyConfigured: true,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        maximumCopyLength: 1_000,
      },
    });
    expect(copyService.preflight()).toMatchObject({
      approved: true,
      enabled: true,
      modelConfigured: true,
      apiKeyConfigured: true,
    });
  });

  it('mantém preview read-only e sanitizado', async () => {
    const repository = new MemoryCopyRepository();
    const before = JSON.stringify(repository.context);
    const report = await service(repository).preview('candidate-internal');
    expect(report.eligible).toBe(true);
    expect(JSON.stringify(report)).not.toContain(affiliateLink);
    expect(JSON.stringify(report)).toContain('[LINK_AFILIADO]');
    expect(JSON.stringify(repository.context)).toBe(before);
    expect(repository.attempts.size).toBe(0);
  });

  it('gera uma copy AI, vincula snapshot e reutiliza COPY_READY sem nova chamada', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const copyService = service(repository, provider);
    const first = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    const second = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    expect(first).toMatchObject({ status: 'COPY_READY', cacheHit: false });
    expect(second).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
    expect(repository.attempts.size).toBe(1);
    expect(JSON.stringify(first)).not.toContain(affiliateLink);
  });

  it('normaliza fatos antes da fronteira do provider', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = '\u0000 Produto   seguro ';
    repository.context!.product.shopName = ' Loja\tsegura ';
    const provider = validProvider();
    await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        productName: 'Produto seguro',
        shopName: 'Loja segura',
      }),
    );
  });

  it('bloqueia copy pronta quando o link atual diverge do snapshot gerado', async () => {
    const repository = new MemoryCopyRepository();
    const copyService = service(repository);
    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    repository.context!.product.affiliateLink =
      'https://example.invalid/affiliate/changed';
    repository.context!.product.updatedAt = new Date('2026-08-01T12:00:01Z');
    await expect(
      copyService.findCopy('candidate-internal'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT' });
  });

  it('mantém QUEUED e marca falha confirmada sem copy', async () => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new CommercialAiCopyProviderError(
            'FAILED_CONFIRMED',
            'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
          ),
        ),
    };
    const copyService = service(repository, provider);
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED' });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.context?.candidate.status).toBe('QUEUED');
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      requestMayHaveStarted: false,
    });
    expect(repository.copies.size).toBe(0);
  });

  it('registra somente diagnóstico sanitizado para falha do provider', async () => {
    const repository = new MemoryCopyRepository();
    const logger = { info: vi.fn(), error: vi.fn() };
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn().mockRejectedValue(
        new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
          {
            httpStatus: 429,
            providerErrorCode: 'insufficient_quota',
            providerErrorType: 'insufficient_quota',
            providerErrorParam: 'model',
          },
        ),
      ),
    };
    const copyService = new CommercialPromotionCopyGenerationService({
      repository,
      provider,
      config: {
        enabled: true,
        provider: 'openai',
        model: 'Selected-Model',
        apiKeyConfigured: true,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        maximumCopyLength: 1_000,
      },
      logger,
      clock: () => now,
    });

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED' });

    const fields = logger.error.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields).toEqual({
      event: 'commercial-ai-copy.provider-failed',
      candidateId: 'candidate-internal',
      provider: 'openai',
      model: 'selected-model',
      publicCode: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
      failureKind: 'FAILED_CONFIRMED',
      httpStatus: 429,
      providerErrorCode: 'insufficient_quota',
      providerErrorType: 'insufficient_quota',
      providerErrorParam: 'model',
    });
    expect(JSON.stringify(fields)).not.toContain('affiliate');
    expect(JSON.stringify(fields)).not.toContain('inputFingerprint');
  });

  it('marca timeout/rede incerta como AMBIGUOUS e bloqueia repetição', async () => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new CommercialAiCopyProviderError(
            'AMBIGUOUS',
            'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
          ),
        ),
    };
    const copyService = service(repository, provider);
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'AMBIGUOUS',
      requestMayHaveStarted: true,
    });
  });

  it('permite somente um provider em duas gerações concorrentes', async () => {
    const repository = new MemoryCopyRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = validProvider();
    vi.mocked(provider.generate).mockImplementation(async () => {
      await gate;
      return {
        output: {
          headline: 'Oferta confiável',
          body: 'Uma escolha prática para sua rotina.',
          cta: 'Confira os detalhes',
          hashtags: ['#Oferta'],
        },
        provider: 'openai',
        model: 'selected-model',
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    });
    const copyService = service(repository, provider);
    const first = copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    await Promise.resolve();
    const second = copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    await expect(second).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'COPY_READY' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('marca falha se snapshot mudar durante a chamada', async () => {
    const repository = new MemoryCopyRepository();
    repository.completionFailure = 'COMMERCIAL_AI_COPY_CATALOG_CHANGED';
    await expect(
      service(repository).generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CATALOG_CHANGED' });
    expect(repository.copies.size).toBe(0);
    expect(repository.context?.candidate.status).toBe('QUEUED');
  });
});
