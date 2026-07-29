import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  CommercialNicheData,
  CommercialNicheRecord,
} from './repositories';

const CREATE_FIELDS = new Set([
  'name',
  'active',
  'categoryIds',
  'includeKeywords',
  'excludeKeywords',
  'minPrice',
  'maxPrice',
  'minDiscountRate',
  'minRating',
  'minSales',
  'minCommissionRate',
  'minimumScore',
]);
const PATCH_FIELDS = new Set(CREATE_FIELDS);
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/;

const invalid = (message: string, code = 'COMMERCIAL_NICHE_INVALID'): never => {
  throw new AppError(message, code);
};

const recordInput = (input: unknown) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return invalid('Body do nicho e invalido');
  }
  return input as Record<string, unknown>;
};

const strictFields = (
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
) => {
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    invalid('O body do nicho contem campos nao permitidos');
  }
};

const normalizedName = (value: unknown) => {
  if (typeof value !== 'string') return invalid('Nome do nicho e invalido');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    invalid('Nome do nicho deve ter entre 2 e 80 caracteres');
  }
  return name;
};

export const normalizeCommercialText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const commercialNicheSlug = (name: string) => {
  const slug = normalizeCommercialText(name).replace(/ /g, '-');
  if (slug.length < 2 || slug.length > 80) {
    return invalid(
      'Nome nao produz um slug ASCII valido',
      'COMMERCIAL_NICHE_SLUG_INVALID',
    );
  }
  return slug;
};

const normalizeCategoryIds = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 30) {
    return invalid('categoryIds deve conter no maximo 30 entradas');
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string') return invalid('categoryId invalido');
    const categoryId = entry.normalize('NFKC').trim().toLowerCase();
    if (!categoryId) return invalid('categoryId invalido');
    return categoryId;
  });
  return [...new Set(normalized)];
};

const normalizeKeywords = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.length > 30) {
    return invalid(`${field} deve conter no maximo 30 entradas`);
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string')
      return invalid(`${field} contem keyword invalida`);
    const keyword = normalizeCommercialText(entry);
    if (keyword.length < 2 || keyword.length > 50) {
      return invalid('Keyword deve ter entre 2 e 50 caracteres');
    }
    return keyword;
  });
  return [...new Set(normalized)];
};

const decimal = (value: unknown, field: string) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string')
    return invalid(`${field} deve ser decimal em string`);
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) return invalid(`${field} e invalido`);
  const [integer, fraction = ''] = normalized.split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
};

const numberInRange = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(`${field} e invalido`);
  }
  return value;
};

const integerInRange = (
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) => {
  const parsed = numberInRange(value, field, minimum, maximum);
  if (!Number.isInteger(parsed)) return invalid(`${field} deve ser inteiro`);
  return parsed;
};

const normalizeFields = (input: Record<string, unknown>) => {
  const minPrice = decimal(input.minPrice, 'minPrice');
  const maxPrice = decimal(input.maxPrice, 'maxPrice');
  if (
    minPrice !== null &&
    maxPrice !== null &&
    Number(minPrice) > Number(maxPrice)
  ) {
    invalid('minPrice nao pode superar maxPrice');
  }
  if (typeof input.active !== 'boolean')
    return invalid('active deve ser booleano');
  return {
    name: normalizedName(input.name),
    active: input.active,
    categoryIds: normalizeCategoryIds(input.categoryIds),
    includeKeywords: normalizeKeywords(
      input.includeKeywords,
      'includeKeywords',
    ),
    excludeKeywords: normalizeKeywords(
      input.excludeKeywords,
      'excludeKeywords',
    ),
    minPrice,
    maxPrice,
    minDiscountRate: numberInRange(
      input.minDiscountRate,
      'minDiscountRate',
      0,
      100,
    ),
    minRating: numberInRange(input.minRating, 'minRating', 0, 5),
    minSales: integerInRange(input.minSales, 'minSales', 0, 2_147_483_647),
    minCommissionRate: numberInRange(
      input.minCommissionRate,
      'minCommissionRate',
      0,
      100,
    ),
    minimumScore: integerInRange(input.minimumScore, 'minimumScore', 0, 100),
  };
};

export const parseCommercialNicheCreate = (
  input: unknown,
): CommercialNicheData => {
  const record = recordInput(input);
  strictFields(record, CREATE_FIELDS);
  const fields = normalizeFields({
    ...record,
    active: record.active ?? true,
    categoryIds: record.categoryIds ?? [],
    includeKeywords: record.includeKeywords ?? [],
    excludeKeywords: record.excludeKeywords ?? [],
    minPrice: record.minPrice ?? null,
    maxPrice: record.maxPrice ?? null,
    minDiscountRate: record.minDiscountRate ?? 5,
    minRating: record.minRating ?? 0,
    minSales: record.minSales ?? 0,
    minCommissionRate: record.minCommissionRate ?? 0,
    minimumScore: record.minimumScore ?? 60,
  });
  return { ...fields, slug: commercialNicheSlug(fields.name) };
};

export const parseCommercialNichePatch = (
  existing: CommercialNicheRecord,
  input: unknown,
): Partial<Omit<CommercialNicheData, 'slug'>> => {
  const record = recordInput(input);
  if ('slug' in record) {
    return invalid(
      'Slug do nicho e imutavel',
      'COMMERCIAL_NICHE_SLUG_IMMUTABLE',
    );
  }
  strictFields(record, PATCH_FIELDS);
  if (Object.keys(record).length === 0)
    return invalid('PATCH do nicho esta vazio');
  const normalized = normalizeFields({ ...existing, ...record });
  return Object.fromEntries(
    Object.keys(record).map((field) => [
      field,
      normalized[field as keyof typeof normalized],
    ]),
  );
};
