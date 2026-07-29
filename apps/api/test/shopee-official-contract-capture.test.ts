import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSanitizedArtifact,
  describeJsonShape,
  extractGraphqlErrors,
  sanitizeCapturedValue,
  sanitizeDocumentationText,
  sanitizeGraphqlPayload,
  sanitizeOfficialUrl,
} from '../src/shopee-official-contract-sanitizer';
import { assertCaptureDirectoryIgnored } from '../src/shopee-official-contract-capture';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Shopee official contract capture sanitizer', () => {
  it('remove valores sensiveis sem remover a descricao do algoritmo', () => {
    const sanitized = sanitizeDocumentationText(
      'Use SHA256 para assinatura. Authorization: valor-real\nSignature=abcdef123456\nSecret: segredo',
    );
    expect(sanitized).toContain('Use SHA256 para assinatura.');
    expect(sanitized).toContain('Authorization:[REMOVIDO]');
    expect(sanitized).toContain('Signature=[REMOVIDO]');
    expect(sanitized).not.toContain('valor-real');
    expect(sanitized).not.toContain('segredo');
  });

  it('preserva somente URL oficial sem query ou fragmento', () => {
    expect(
      sanitizeOfficialUrl(
        'https://open-api.affiliate.shopee.com.br/graphql?token=private#x',
      ),
    ).toBe('https://open-api.affiliate.shopee.com.br/graphql');
    expect(() =>
      sanitizeOfficialUrl('https://example.invalid/graphql'),
    ).toThrow('SHOPEE_CAPTURE_NON_OFFICIAL_HOST');
    expect(() =>
      sanitizeOfficialUrl('http://open-api.affiliate.shopee.com.br/graphql'),
    ).toThrow('SHOPEE_CAPTURE_NON_OFFICIAL_HOST');
  });

  it('sanitiza recursivamente campos sensiveis e preserva campos publicos', () => {
    expect(
      sanitizeCapturedValue({
        appId: 'private-app',
        nested: { access_token: 'private-token', page: 1 },
        limit: 5,
      }),
    ).toEqual({
      appId: '[REMOVIDO]',
      nested: { access_token: '[REMOVIDO]', page: 1 },
      limit: 5,
    });
  });

  it('captura somente query productOfferV2 e variables sanitizadas', () => {
    expect(
      sanitizeGraphqlPayload({
        operationName: 'ProductOffers',
        query:
          'query ProductOffers { productOfferV2 { pageInfo { scrollId } } }',
        variables: { limit: 5, credential: 'private' },
      }),
    ).toEqual({
      operationName: 'ProductOffers',
      query: 'query ProductOffers { productOfferV2 { pageInfo { scrollId } } }',
      variables: { limit: 'number', credential: '[REMOVIDO]' },
    });
    expect(() =>
      sanitizeGraphqlPayload({ query: '{ shopOfferV2 { id } }' }),
    ).toThrow('SHOPEE_CAPTURE_PRODUCT_OFFER_QUERY_REQUIRED');
  });

  it('descreve schema e erros GraphQL sem persistir valores de produto', () => {
    const response = {
      data: { productOfferV2: { nodes: [{ itemId: '123', price: '9.90' }] } },
      errors: [
        {
          message: 'Authorization: private',
          extensions: { code: 'UNAUTHENTICATED', token: 'private' },
        },
      ],
    };
    expect(describeJsonShape(response)).toEqual({
      data: {
        productOfferV2: { nodes: [{ itemId: 'string', price: 'string' }] },
      },
      errors: [
        {
          message: 'string',
          extensions: { code: 'string', token: '[REMOVIDO]' },
        },
      ],
    });
    expect(extractGraphqlErrors(response)).toEqual([
      {
        messageType: 'string',
        path: 'null',
        code: '[REMOVIDO]',
        extensionsSchema: { code: 'string', token: '[REMOVIDO]' },
      },
    ]);
  });

  it('falha fechado quando um artefato ainda contem valor sensivel', () => {
    expect(() => assertSanitizedArtifact('Authorization: raw-value')).toThrow(
      'SHOPEE_CAPTURE_SANITIZATION_UNCERTAIN',
    );
    expect(() =>
      assertSanitizedArtifact('Authorization:[REMOVIDO]'),
    ).not.toThrow();
  });

  it('exige que o diretorio de captura esteja ignorado', () => {
    const root = mkdtempSync(join(tmpdir(), 'shopee-capture-ignore-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, '.runtime'), { recursive: true });
    writeFileSync(join(root, '.gitignore'), '.runtime/\n', 'utf8');
    expect(() => assertCaptureDirectoryIgnored(root)).toThrow(
      'SHOPEE_CAPTURE_DIRECTORY_NOT_IGNORED',
    );
  });
});
