import type {
  ShopeeAffiliateOfferProvider,
  ShopeeProductOffer,
  ShopeeProductOfferListInput,
} from './shopee-affiliate-offers';

const categories = ['100001', '100002', '100003'];

const mockOffers: ShopeeProductOffer[] = Array.from(
  { length: 24 },
  (_, index) => {
    const number = index + 1;
    const price = (29.9 + index * 6.25).toFixed(2);
    return {
      source: 'MOCK',
      providerProductId: `mock-affiliate-${String(number).padStart(3, '0')}`,
      productName: `Produto ficticio afiliado ${number}`,
      ...(index % 4 === 0 ? {} : { shopId: `mock-shop-${(index % 5) + 1}` }),
      shopName:
        index === 0
          ? 'Loja oficial ficticia'
          : `Loja ficticia ${(index % 5) + 1}`,
      categoryIds: [categories[index % categories.length]],
      price,
      priceMin: price,
      priceMax: index % 6 === 0 ? (Number(price) + 20).toFixed(2) : price,
      discountRate: index === 0 ? 50 : 5 + (index % 8) * 5,
      rating: index === 0 ? 4.9 : Number((4 + (index % 10) / 10).toFixed(1)),
      sales: index === 0 ? 10000 : 50 + index * 125,
      commissionRate: index === 0 ? 20 : 3 + (index % 8),
      ...(index % 3 === 0
        ? { commissionAmount: (Number(price) * 0.05).toFixed(2) }
        : {}),
      sellerCommissionRate: index % 2 === 0 ? 2 : undefined,
      shopeeCommissionRate: index % 2 === 0 ? 3 : undefined,
      imageUrl: `https://example.invalid/images/product-${number}.jpg`,
      productLink: `https://example.invalid/products/${number}`,
      affiliateLink: `https://example.invalid/affiliate/${number}`,
      offerStartsAt: new Date('2026-01-01T00:00:00.000Z'),
      offerEndsAt: new Date('2099-12-31T23:59:59.000Z'),
      fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
  },
);

const decimal = (value: string) => Number(value);

export class MockShopeeAffiliateOfferProvider implements ShopeeAffiliateOfferProvider {
  readonly source = 'MOCK' as const;

  async listProductOffers(input: ShopeeProductOfferListInput = {}) {
    const keyword = input.keyword?.trim().toLocaleLowerCase('pt-BR');
    let filtered = mockOffers.filter(
      (offer) =>
        (!keyword ||
          offer.productName.toLocaleLowerCase('pt-BR').includes(keyword) ||
          offer.shopName.toLocaleLowerCase('pt-BR').includes(keyword)) &&
        (!input.categoryId || offer.categoryIds.includes(input.categoryId)) &&
        (!input.minPrice || decimal(offer.price) >= decimal(input.minPrice)) &&
        (!input.maxPrice || decimal(offer.price) <= decimal(input.maxPrice)) &&
        (input.minCommissionRate === undefined ||
          offer.commissionRate >= input.minCommissionRate) &&
        (input.minDiscountRate === undefined ||
          offer.discountRate >= input.minDiscountRate) &&
        (input.minRating === undefined || offer.rating >= input.minRating),
    );

    filtered = [...filtered].sort((left, right) => {
      if (input.sort === 'price_asc')
        return decimal(left.price) - decimal(right.price);
      if (input.sort === 'price_desc')
        return decimal(right.price) - decimal(left.price);
      if (input.sort === 'commission_desc')
        return right.commissionRate - left.commissionRate;
      if (input.sort === 'sales_desc') return right.sales - left.sales;
      return left.providerProductId.localeCompare(right.providerProductId);
    });

    const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);
    const cursorOffset = input.cursor?.match(/^offset:(\d+)$/);
    const page = cursorOffset
      ? Math.floor(Number(cursorOffset[1]) / limit) + 1
      : Math.max(input.page ?? 1, 1);
    const start = cursorOffset ? Number(cursorOffset[1]) : (page - 1) * limit;
    const items = filtered
      .slice(start, start + limit)
      .map((offer) => ({ ...offer }));
    const hasNextPage = start + items.length < filtered.length;
    return {
      items,
      page,
      limit,
      hasNextPage,
      ...(hasNextPage ? { nextCursor: `offset:${start + items.length}` } : {}),
    };
  }
}
