import { apiRequest } from './client';
import type {
  CopyPreview,
  DashboardProduct,
  ManualOfferValidation,
  ShopeeOfferFilters,
  ShopeeOfferPage,
  ShopeeOfferSyncReport,
} from './types';

const filtersToQuery = (filters: ShopeeOfferFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.keyword) params.set('keyword', filters.keyword);
  if (filters.source) params.set('source', filters.source);
  if (filters.status) params.set('status', filters.status);
  if (filters.affiliateLink) params.set('affiliateLink', filters.affiliateLink);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const listShopeeOffers = (filters: ShopeeOfferFilters = {}) =>
  apiRequest<ShopeeOfferPage>(`/shopee/offers${filtersToQuery(filters)}`);

export const syncShopeeOffers = () =>
  apiRequest<ShopeeOfferSyncReport>('/shopee/offers/sync', { method: 'POST' });

export const validateManualShopeeOffers = (records: unknown[]) =>
  apiRequest<ManualOfferValidation>('/shopee/offers/import/validate', {
    method: 'POST',
    body: { records },
  });

export const importManualShopeeOffers = (records: unknown[]) =>
  apiRequest<ShopeeOfferSyncReport>('/shopee/offers/import', {
    method: 'POST',
    body: { records, confirm: 'CONFIRMAR_IMPORTACAO' },
  });

export const previewShopeeOfferCopy = (id: string) =>
  apiRequest<CopyPreview>(
    `/shopee/offers/${encodeURIComponent(id)}/copy-preview`,
    { method: 'POST' },
  );

export const listProductsFromDispatches = async (): Promise<
  DashboardProduct[]
> => {
  const page = await listShopeeOffers({ page: 1, limit: 100 });
  return page.items.map((offer) => ({
    id: offer.id,
    providerProductId: offer.providerProductId,
    nome: offer.productName,
    categoria: offer.categoryIds[0] ?? 'Sem categoria',
    preco: Number(offer.price),
    desconto: offer.discountRate,
    nota: offer.rating,
    vendidos: offer.sales,
    comissao: offer.commissionRate,
    loja: offer.shopName,
    urlImagem: offer.imageUrl,
    url: offer.productLink,
    score: offer.score,
    scoreUpdatedAt: offer.scoreUpdatedAt,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  }));
};
