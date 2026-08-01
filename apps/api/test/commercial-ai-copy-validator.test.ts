import { describe, expect, it } from 'vitest';

import {
  COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES,
  CommercialAiCopyValidator,
  sanitizeCommercialAiCopyValidationFailureCodes,
} from '../src/commercial-ai-copy-validator';

const valid = {
  headline: 'Oferta para escolher bem ✨',
  body: 'Uma opção prática e confiável para o seu dia.',
  cta: 'Confira os detalhes',
  hashtags: ['#Oferta', '#Escolha'],
};

describe('CommercialAiCopyValidator', () => {
  const validator = new CommercialAiCopyValidator();

  it('normaliza e aceita output válido', () => {
    expect(
      validator.validate({
        ...valid,
        body: '  Uma   opção prática e confiável para o seu dia.  ',
      }),
    ).toEqual({
      valid: true,
      sanitizedOutput: {
        ...valid,
        body: 'Uma opção prática e confiável para o seu dia.',
      },
      publicFailureCodes: [],
    });
  });

  it.each([
    [{ ...valid, extra: true }, 'AI_OUTPUT_EXTRA_PROPERTY'],
    [{ ...valid, headline: '' }, 'AI_HEADLINE_LENGTH'],
    [{ ...valid, headline: 'x'.repeat(91) }, 'AI_HEADLINE_LENGTH'],
    [{ ...valid, body: '' }, 'AI_BODY_LENGTH'],
    [{ ...valid, body: 'x'.repeat(261) }, 'AI_BODY_LENGTH'],
    [{ ...valid, cta: '' }, 'AI_CTA_LENGTH'],
    [{ ...valid, cta: 'x'.repeat(71) }, 'AI_CTA_LENGTH'],
    [{ ...valid, hashtags: ['#a', '#b', '#c', '#d'] }, 'AI_HASHTAGS_INVALID'],
    [
      { ...valid, body: 'Veja https://example.invalid agora' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [
      { ...valid, body: 'Escreva para teste@example.com' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [{ ...valid, body: 'Preço R$ especial' }, 'AI_FACTUAL_VALUE_FORBIDDEN'],
    [
      { ...valid, body: 'Desconto de dez % disponível' },
      'AI_FACTUAL_VALUE_FORBIDDEN',
    ],
    [{ ...valid, body: 'Oferta com 9 vantagens' }, 'AI_DIGIT_FORBIDDEN'],
    [{ ...valid, body: 'Frete grátis para sua compra' }, 'AI_PROHIBITED_CLAIM'],
    [{ ...valid, body: 'Últimas unidades no estoque' }, 'AI_PROHIBITED_CLAIM'],
    [
      { ...valid, body: 'Produto original e com garantia' },
      'AI_PROHIBITED_CLAIM',
    ],
    [{ ...valid, body: 'O mais vendido com cashback' }, 'AI_PROHIBITED_CLAIM'],
    [{ ...valid, hashtags: ['#Oferta', '#oferta'] }, 'AI_HASHTAGS_DUPLICATED'],
    [{ ...valid, hashtags: ['#Oferta2'] }, 'AI_HASHTAGS_INVALID'],
    [
      { ...valid, body: '✨✨✨✨✨✨✨ Texto confiável e natural' },
      'AI_EMOJI_LIMIT',
    ],
    [
      { ...valid, body: 'Uma [oferta](https://example.invalid)' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [
      { ...valid, body: 'Uma oferta\ncom controle oculto' },
      'AI_CONTROL_CHARACTER',
    ],
    [
      { ...valid, body: 'Confira em exemplo.io agora' },
      'AI_URL_OR_CONTACT_FORBIDDEN',
    ],
    [{ ...valid, body: 'Uma **oferta** confiável' }, 'AI_MARKDOWN_FORBIDDEN'],
    [
      { ...valid, body: 'Oferta com dígito de largura total １' },
      'AI_DIGIT_FORBIDDEN',
    ],
  ])('rejeita conteúdo inseguro %#', (output, code) => {
    const result = validator.validate(output);
    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain(code);
    expect(result).not.toHaveProperty('invalidOutput');
  });

  it('rejeita repetição contextual do produto ou da loja', () => {
    const result = validator.validate(
      { ...valid, body: 'Produto Exato é uma escolha prática e confiável.' },
      ['Produto Exato', 'Loja Exata'],
    );
    expect(result.valid).toBe(false);
    expect(result.publicFailureCodes).toContain('AI_CATALOG_FACT_REPEATED');
  });
});

describe('sanitizeCommercialAiCopyValidationFailureCodes', () => {
  it('handles non-arrays', () => {
    expect(sanitizeCommercialAiCopyValidationFailureCodes(undefined)).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes(null)).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes('not array')).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes(123)).toEqual([]);
    expect(sanitizeCommercialAiCopyValidationFailureCodes({})).toEqual([]);
  });
  it('handles empty array', () => {
    expect(sanitizeCommercialAiCopyValidationFailureCodes([])).toEqual([]);
  });
  it('keeps valid codes and removes duplicates and sorts', () => {
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_OUTPUT_EXTRA_PROPERTY',
        'AI_HEADLINE_LENGTH',
        'AI_OUTPUT_EXTRA_PROPERTY',
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH', 'AI_OUTPUT_EXTRA_PROPERTY']);
  });
  it('removes invalid types or empty or long strings', () => {
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_HEADLINE_LENGTH',
        '',
        'x'.repeat(101),
        123,
        null,
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH']);
  });
  it('removes unknown codes', () => {
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes([
        'AI_HEADLINE_LENGTH',
        'UNKNOWN_CODE',
      ]),
    ).toEqual(['AI_HEADLINE_LENGTH']);
  });
  it('limits to 20 codes', () => {
    const all = [...COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES];
    const limited = sanitizeCommercialAiCopyValidationFailureCodes(all);
    expect(limited.length).toBeLessThanOrEqual(20);
    expect(limited).toEqual(all.sort().slice(0, 20));
  });
  it('does not throw on malformed mixed input', () => {
    expect(() =>
      sanitizeCommercialAiCopyValidationFailureCodes(['AI_HEADLINE_LENGTH', { foo: 'bar' }, undefined, 'UNKNOWN']),
    ).not.toThrow();
    expect(
      sanitizeCommercialAiCopyValidationFailureCodes(['AI_HEADLINE_LENGTH', { foo: 'bar' }, undefined, 'UNKNOWN']),
    ).toEqual(['AI_HEADLINE_LENGTH']);
  });
});
