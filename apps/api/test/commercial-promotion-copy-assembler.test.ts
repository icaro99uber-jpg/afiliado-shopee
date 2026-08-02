import { describe, expect, it } from 'vitest';

import { commercialAiCopyInputFingerprint } from '../src/commercial-ai-copy-fingerprint';
import {
  CommercialPromotionCopyAssembler,
  sanitizeCommercialPromotionCopy,
} from '../src/commercial-promotion-copy-assembler';

const output = {
  headline: 'Oferta confiável',
  body: 'Uma escolha prática para sua rotina.',
  cta: 'Confira os detalhes',
  hashtags: ['#Oferta', '#Casa'],
};

const base = {
  output,
  productName: 'Produto Exato',
  shopName: 'Loja Exata',
  price: '123.4500',
  discountRate: 15,
  promotionSignals: [
    'PRICE_DROP',
    'DISCOUNT_INCREASE',
    'NEWLY_OBSERVED',
  ] as const,
  priceDropPercent: '12.3400',
  affiliateLink: 'https://example.invalid/affiliate/exact',
  maximumLength: 1000,
};

describe('CommercialPromotionCopyAssembler', () => {
  const assembler = new CommercialPromotionCopyAssembler();

  it('insere fatos e link deterministicamente com prioridade do sinal', () => {
    const copy = assembler.assemble({
      ...base,
      promotionSignals: [...base.promotionSignals],
    });
    expect(copy.titulo).toBe(output.headline);
    expect(copy.mensagem).toContain('📦 Produto: Produto Exato');
    expect(copy.mensagem).toContain('🏪 Loja: Loja Exata');
    expect(copy.mensagem).toContain('💰 Preço: R$ 123,45');
    expect(copy.mensagem).toContain('💸 Desconto: 15%');
    expect(copy.mensagem).toContain('Queda de 12,34%');
    expect(copy.mensagem).not.toContain('O desconto informado aumentou');
    expect(copy.cta.split(base.affiliateLink)).toHaveLength(2);
    expect(copy.hashtags).toBe('#Oferta #Casa');
    expect(
      sanitizeCommercialPromotionCopy(copy, base.affiliateLink).cta,
    ).toContain('[LINK_AFILIADO]');
  });

  it('preserva exatamente um link válido mesmo quando a URL canônica difere', () => {
    const affiliateLink = 'https://EXAMPLE.invalid/Affiliate';
    const copy = assembler.assemble({
      ...base,
      affiliateLink,
      promotionSignals: [],
    });
    expect(copy.cta).toBe(`${output.cta}\n${affiliateLink}`);
  });

  it('sanitiza por allowlist e remove links antigos defensivamente', () => {
    const copy = assembler.assemble({
      ...base,
      affiliateLink: 'https://old.example/path',
      promotionSignals: [],
    });
    const sanitized = sanitizeCommercialPromotionCopy(
      {
        ...copy,
        inputFingerprint: 'must-not-leak',
        snapshotId: 'must-not-leak',
      } as typeof copy,
      'https://current.example/path',
    );
    expect(Object.keys(sanitized).sort()).toEqual([
      'cta',
      'hashtags',
      'mensagem',
      'titulo',
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('must-not-leak');
    expect(sanitized.cta).toContain('[LINK_REMOVIDO]');
    expect(sanitized.cta).not.toContain('old.example');
  });

  it.each([
    [['DISCOUNT_INCREASE'], 'O desconto informado aumentou'],
    [['NEWLY_OBSERVED'], 'recém-observada pelo nosso sistema'],
    [['CURRENT_DISCOUNT'], null],
  ] as const)(
    'monta sinal %s sem afirmação extra indevida',
    (signals, phrase) => {
      const copy = assembler.assemble({
        ...base,
        promotionSignals: [...signals],
        priceDropPercent: null,
        discountRate: signals[0] === 'CURRENT_DISCOUNT' ? 5 : 0,
      });
      if (phrase) expect(copy.mensagem).toContain(phrase);
      else expect(copy.mensagem).not.toContain('medição anterior');
    },
  );

  it('rejeita URL adicional e tamanho sem truncar', () => {
    expect(() =>
      assembler.assemble({
        ...base,
        output: { ...output, body: 'Veja https://example.invalid/extra' },
        promotionSignals: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_URL_INVALID' }),
    );
    expect(() =>
      assembler.assemble({
        ...base,
        productName: 'Produto www.example.com',
        promotionSignals: [],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_URL_INVALID' }),
    );
    expect(() =>
      assembler.assemble({ ...base, promotionSignals: [], maximumLength: 20 }),
    ).toThrowError(
      expect.objectContaining({ code: 'COMMERCIAL_AI_COPY_TOO_LONG' }),
    );
  });
});

describe('commercialAiCopyInputFingerprint', () => {
  const input = {
    promptVersion: 'commercial-promotion-copy-v1',
    validationVersion: 'commercial-promotion-copy-validation-v1',
    provider: 'openai',
    model: 'selected-model',
    campaignId: 'campaign-internal',
    campaignUpdatedAt: new Date('2026-08-01T12:00:00Z'),
    nicheId: 'niche-internal',
    nicheUpdatedAt: new Date('2026-08-01T12:00:00Z'),
    candidateId: 'candidate-internal',
    productId: 'product-internal',
    productUpdatedAt: new Date('2026-08-01T12:00:00Z'),
    snapshotId: 'snapshot-internal',
    snapshotRevision: 2,
    snapshotFingerprint: 'snapshot-fingerprint',
    commercialScore: 80,
    promotionSignals: ['PRICE_DROP', 'CURRENT_DISCOUNT'] as const,
    priceDropPercent: '12.3400',
    productName: 'Produto',
    shopName: 'Loja',
    price: '123.4500',
    discountRate: 15,
    rating: 4.8,
    sales: 500,
    affiliateLink: 'https://example.invalid/affiliate/exact',
    maximumLength: 1000,
  };

  it('é determinístico, canonicaliza sinais e não contém o link bruto', () => {
    const first = commercialAiCopyInputFingerprint({
      ...input,
      promotionSignals: [...input.promotionSignals],
    });
    const second = commercialAiCopyInputFingerprint({
      ...input,
      price: '123.45',
      priceDropPercent: '12.34',
      promotionSignals: [...input.promotionSignals].reverse(),
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(input.affiliateLink);
  });

  it.each([
    'model',
    'promptVersion',
    'snapshotId',
    'price',
    'affiliateLink',
  ] as const)('muda quando %s muda', (field) => {
    const first = commercialAiCopyInputFingerprint({
      ...input,
      promotionSignals: [...input.promotionSignals],
    });
    const changed = commercialAiCopyInputFingerprint({
      ...input,
      [field]: `${input[field]}-changed`,
      promotionSignals: [...input.promotionSignals],
    });
    expect(changed).not.toBe(first);
  });

  it('separa fingerprints de validação v1 e v2 sem alterar o histórico', () => {
    const v1 = commercialAiCopyInputFingerprint({
      ...input,
      validationVersion: 'commercial-promotion-copy-validation-v1',
      promotionSignals: [...input.promotionSignals],
    });
    const v2 = commercialAiCopyInputFingerprint({
      ...input,
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    expect(v2).not.toBe(v1);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        validationVersion: 'commercial-promotion-copy-validation-v2',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(v2);
  });

  it('separa fingerprints de prompt v1 e v2 mantendo a mesma validationVersion', () => {
    const promptV1 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v1',
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    const promptV2 = commercialAiCopyInputFingerprint({
      ...input,
      promptVersion: 'commercial-promotion-copy-v2',
      validationVersion: 'commercial-promotion-copy-validation-v2',
      promotionSignals: [...input.promotionSignals],
    });
    expect(promptV2).not.toBe(promptV1);
    expect(
      commercialAiCopyInputFingerprint({
        ...input,
        promptVersion: 'commercial-promotion-copy-v2',
        validationVersion: 'commercial-promotion-copy-validation-v2',
        promotionSignals: [...input.promotionSignals],
      }),
    ).toBe(promptV2);
  });
});
