import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ShopeeOfferSort } from '@shopee-auto-affiliate-ai/providers';

export type ShopeeOfficialCatalogCliArgs = {
  keyword?: string;
  categoryId?: number;
  sort?: ShopeeOfferSort;
  pageSize: number;
  maxPages: number;
};

export const parseShopeeOfficialCatalogCliArgs = (
  rawArgs: string[],
  limits: {
    maximumPageSize: number;
    maximumPages: number;
    maximumProducts: number;
  },
): ShopeeOfficialCatalogCliArgs => {
  const args = rawArgs.includes('--')
    ? rawArgs.slice(rawArgs.indexOf('--') + 1)
    : rawArgs;

  let hasConfirm = false;
  let keyword: string | undefined;
  let categoryId: number | undefined;
  let sort: ShopeeOfferSort | undefined;
  let pageSize: number | undefined;
  let maxPages: number | undefined;

  const seenFlags = new Set<string>();

  for (const arg of args) {
    if (arg === '--confirm-local-official-catalog-sync') {
      if (hasConfirm) {
        throw new AppError(
          'Flag duplicada: --confirm-local-official-catalog-sync',
          'SHOPEE_OFFICIAL_CATALOG_DUPLICATE_FLAG',
        );
      }
      hasConfirm = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new AppError(
        `Argumento posicional nao permitido: ${arg}`,
        'SHOPEE_OFFICIAL_CATALOG_UNKNOWN_ARGUMENT',
      );
    }

    const [key, ...valueParts] = arg.split('=');
    const rawValue = valueParts.join('=');
    const value = rawValue.trim();

    if (seenFlags.has(key)) {
      throw new AppError(
        `Flag duplicada: ${key}`,
        'SHOPEE_OFFICIAL_CATALOG_DUPLICATE_FLAG',
      );
    }
    seenFlags.add(key);

    if (value === '') {
      throw new AppError(
        `Valor ausente para a flag: ${key}`,
        'SHOPEE_OFFICIAL_CATALOG_MISSING_VALUE',
      );
    }

    switch (key) {
      case '--keyword': {
        const normalized = value.normalize('NFKC');
        if (normalized.length === 0) {
          throw new AppError(
            'Keyword vazia',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_KEYWORD',
          );
        }
        if (normalized.length > 100) {
          throw new AppError(
            'Keyword excede 100 caracteres',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_KEYWORD',
          );
        }
        if (/[\x00-\x1F\x7F]/.test(normalized)) {
          throw new AppError(
            'Keyword contem caracteres de controle',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_KEYWORD',
          );
        }
        keyword = normalized;
        break;
      }
      case '--category-id': {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new AppError(
            'Category ID invalido',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_CATEGORY_ID',
          );
        }
        categoryId = parsed;
        break;
      }
      case '--sort': {
        if (
          value !== 'relevance' &&
          value !== 'price_asc' &&
          value !== 'price_desc' &&
          value !== 'commission_desc' &&
          value !== 'sales_desc'
        ) {
          throw new AppError(
            'Sort invalido',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_SORT',
          );
        }
        sort = value as ShopeeOfferSort;
        break;
      }
      case '--page-size': {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new AppError(
            'Page size invalido',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_PAGE_SIZE',
          );
        }
        pageSize = parsed;
        break;
      }
      case '--max-pages': {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new AppError(
            'Max pages invalido',
            'SHOPEE_OFFICIAL_CATALOG_INVALID_MAX_PAGES',
          );
        }
        maxPages = parsed;
        break;
      }
      default:
        throw new AppError(
          `Argumento desconhecido ou invalido: ${key}`,
          'SHOPEE_OFFICIAL_CATALOG_UNKNOWN_ARGUMENT',
        );
    }
  }

  if (!hasConfirm) {
    throw new AppError(
      'Falta flag de confirmacao obrigatoria',
      'SHOPEE_OFFICIAL_CATALOG_CONFIRMATION_REQUIRED',
    );
  }

  const effectivePageSize = pageSize ?? limits.maximumPageSize;
  const effectiveMaxPages = maxPages ?? limits.maximumPages;

  if (effectivePageSize > limits.maximumPageSize) {
    throw new AppError(
      'Page size acima da configuracao',
      'SHOPEE_OFFICIAL_CATALOG_INVALID_PAGE_SIZE',
    );
  }

  if (effectiveMaxPages > limits.maximumPages) {
    throw new AppError(
      'Max pages acima da configuracao',
      'SHOPEE_OFFICIAL_CATALOG_INVALID_MAX_PAGES',
    );
  }

  if (effectivePageSize * effectiveMaxPages > limits.maximumProducts) {
    throw new AppError(
      'Produto total acima do maximo',
      'SHOPEE_OFFICIAL_CATALOG_TOTAL_LIMIT_EXCEEDED',
    );
  }

  return { keyword, categoryId, sort, pageSize: effectivePageSize, maxPages: effectiveMaxPages };
};
