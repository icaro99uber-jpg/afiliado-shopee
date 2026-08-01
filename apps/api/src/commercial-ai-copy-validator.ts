import type { CommercialAiCopyOutput } from './commercial-ai-copy-provider';

export type CommercialAiCopyValidationResult = {
  valid: boolean;
  sanitizedOutput?: CommercialAiCopyOutput;
  publicFailureCodes: string[];
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const DIGIT = /[0-9]/u;
const URL_OR_CONTACT =
  /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b(?:[\p{L}0-9-]+\.)+[\p{L}]{2,63}\b|[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[\p{L}]{2,}|\+?\d[\d\s().-]{6,}\d)/iu;
const MARKDOWN = /(?:\[[^\]]+\]\([^)]+\)|[*_~`]{1,3}\S)/u;
const MONEY_OR_PERCENT = /(?:R\s*\$|%)/iu;
const HASHTAG = /^#[\p{L}\p{M}_]+$/u;
const EMOJI = /\p{Extended_Pictographic}/gu;

const normalize = (value: string) =>
  value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

const normalizedForPolicy = (value: string) =>
  normalize(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');

const prohibitedPhrases = [
  'frete gratis',
  'cupom',
  'estoque',
  'ultimas unidades',
  'so hoje',
  'corre',
  'acaba hoje',
  'tempo limitado',
  'menor preco',
  'preco historico',
  'garantia',
  'garantido',
  'original',
  'autentico',
  'loja oficial',
  'vendedor oficial',
  'cashback',
  'desconto extra',
  'entrega hoje',
  'entrega garantida',
  'mais vendido',
  'numero um',
  'exclusivo',
  'aproveite antes que acabe',
  'oportunidade unica',
] as const;

const containsPhrase = (text: string, phrase: string) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, 'u').test(text);
};

const hasProhibitedClaim = (value: string) => {
  const text = normalizedForPolicy(value);
  if (prohibitedPhrases.some((phrase) => containsPhrase(text, phrase))) {
    return true;
  }
  return (
    containsPhrase(text, 'imperdivel') &&
    ['so hoje', 'tempo limitado', 'acaba hoje', 'antes que acabe'].some(
      (phrase) => containsPhrase(text, phrase),
    )
  );
};

const repeatedWords = (value: string) =>
  /\b([\p{L}]{3,})(?:\s+\1){2,}\b/iu.test(normalizedForPolicy(value));

const add = (failures: Set<string>, condition: boolean, code: string) => {
  if (condition) failures.add(code);
};

export class CommercialAiCopyValidator {
  validate(
    output: unknown,
    disallowedCatalogFacts: readonly string[] = [],
  ): CommercialAiCopyValidationResult {
    const failures = new Set<string>();
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return {
        valid: false,
        publicFailureCodes: ['AI_OUTPUT_STRUCTURE_INVALID'],
      };
    }
    const record = output as Record<string, unknown>;
    add(
      failures,
      Object.keys(record).some(
        (key) => !['headline', 'body', 'cta', 'hashtags'].includes(key),
      ),
      'AI_OUTPUT_EXTRA_PROPERTY',
    );
    const rawHeadline =
      typeof record.headline === 'string' ? record.headline : '';
    const rawBody = typeof record.body === 'string' ? record.body : '';
    const rawCta = typeof record.cta === 'string' ? record.cta : '';
    const rawHashtags = Array.isArray(record.hashtags)
      ? record.hashtags.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const headline = normalize(rawHeadline);
    const body = normalize(rawBody);
    const cta = normalize(rawCta);
    const hashtags = Array.isArray(record.hashtags)
      ? record.hashtags.map((value) =>
          typeof value === 'string' ? normalize(value) : '',
        )
      : [];
    add(
      failures,
      headline.length < 5 || headline.length > 90,
      'AI_HEADLINE_LENGTH',
    );
    add(failures, body.length < 10 || body.length > 260, 'AI_BODY_LENGTH');
    add(failures, cta.length < 3 || cta.length > 70, 'AI_CTA_LENGTH');
    add(
      failures,
      !Array.isArray(record.hashtags) || hashtags.length > 3,
      'AI_HASHTAGS_INVALID',
    );
    const textual = [headline, body, cta];
    add(
      failures,
      [rawHeadline, rawBody, rawCta, ...rawHashtags].some((value) =>
        CONTROL_CHARACTERS.test(value),
      ),
      'AI_CONTROL_CHARACTER',
    );
    add(
      failures,
      textual.some((value) => DIGIT.test(value)),
      'AI_DIGIT_FORBIDDEN',
    );
    add(
      failures,
      textual.some((value) => URL_OR_CONTACT.test(value)),
      'AI_URL_OR_CONTACT_FORBIDDEN',
    );
    add(
      failures,
      textual.some((value) => MARKDOWN.test(value)),
      'AI_MARKDOWN_FORBIDDEN',
    );
    add(
      failures,
      textual.some((value) => MONEY_OR_PERCENT.test(value)),
      'AI_FACTUAL_VALUE_FORBIDDEN',
    );
    add(failures, textual.some(hasProhibitedClaim), 'AI_PROHIBITED_CLAIM');
    add(failures, textual.some(repeatedWords), 'AI_REPETITION_INVALID');
    const normalizedText = normalizedForPolicy(textual.join(' '));
    add(
      failures,
      disallowedCatalogFacts.some((fact) => {
        const normalizedFact = normalizedForPolicy(fact);
        return (
          Boolean(normalizedFact) &&
          containsPhrase(normalizedText, normalizedFact)
        );
      }),
      'AI_CATALOG_FACT_REPEATED',
    );
    add(
      failures,
      textual.join('').match(EMOJI)?.length !== undefined &&
        (textual.join('').match(EMOJI)?.length ?? 0) > 6,
      'AI_EMOJI_LIMIT',
    );
    add(
      failures,
      hashtags.some(
        (tag) =>
          tag.length < 2 ||
          tag.length > 40 ||
          !HASHTAG.test(tag) ||
          DIGIT.test(tag),
      ),
      'AI_HASHTAGS_INVALID',
    );
    add(
      failures,
      new Set(hashtags.map(normalizedForPolicy)).size !== hashtags.length,
      'AI_HASHTAGS_DUPLICATED',
    );
    const publicFailureCodes = [...failures].sort();
    return publicFailureCodes.length > 0
      ? { valid: false, publicFailureCodes }
      : {
          valid: true,
          sanitizedOutput: { headline, body, cta, hashtags },
          publicFailureCodes,
        };
  }
}
