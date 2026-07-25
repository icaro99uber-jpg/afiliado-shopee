import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import ProductsPage from './page';

const listMock = vi.fn();
const syncMock = vi.fn();
const previewMock = vi.fn();
const validateMock = vi.fn();
const importMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listShopeeOffers: (...args: unknown[]) => listMock(...args),
  syncShopeeOffers: (...args: unknown[]) => syncMock(...args),
  previewShopeeOfferCopy: (...args: unknown[]) => previewMock(...args),
  validateManualShopeeOffers: (...args: unknown[]) => validateMock(...args),
  importManualShopeeOffers: (...args: unknown[]) => importMock(...args),
}));

const offer = {
  id: 'offer-1',
  source: 'MOCK',
  providerProductId: 'mock-1',
  productName: 'Produto ficticio',
  shopName: 'Loja ficticia',
  categoryIds: ['100001'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: '2026-07-24T00:00:00.000Z',
  lastSeenAt: '2026-07-24T00:00:00.000Z',
  score: 80,
  scoreUpdatedAt: null,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  status: 'ACTIVE',
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({
    provider: 'mock',
    items: [offer],
    page: 1,
    limit: 12,
    total: 1,
    totalPages: 1,
  });
  syncMock
    .mockReset()
    .mockResolvedValue({ created: 1, updated: 0, expired: 0 });
  previewMock.mockReset().mockResolvedValue({
    label: 'PREVIEW — NAO ENVIADO',
    titulo: 'Oferta: Produto ficticio',
    mensagem: 'Mensagem armazenada',
    cta: 'Confira a oferta',
    affiliateLink: 'https://example.invalid/affiliate',
    coupon: null,
  });
});

describe('ProductsPage', () => {
  it('exibe catalogo real da API e preview sem envio', async () => {
    const screen = await render(<ProductsPage />);
    expect(screen.container.textContent).toContain('Produto ficticio');
    expect(screen.container.textContent).toContain('Provider atual');
    const previewButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Preview') as HTMLButtonElement;
    await click(previewButton);
    expect(previewMock).toHaveBeenCalledWith('offer-1');
    expect(screen.container.textContent).toContain('PREVIEW — NAO ENVIADO');
    await screen.unmount();
  });

  it('sincroniza sem acionar pipeline ou WhatsApp', async () => {
    const screen = await render(<ProductsPage />);
    const button = Array.from(screen.container.querySelectorAll('button')).find(
      (item) => item.textContent?.includes('Sincronizar ofertas'),
    ) as HTMLButtonElement;
    await click(button);
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain('Sincronizacao segura');
    await screen.unmount();
  });
});
