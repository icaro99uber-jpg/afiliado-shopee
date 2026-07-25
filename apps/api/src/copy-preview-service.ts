import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ShopeeOfferRepository } from './repositories';

const currency = (value: string) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value));

export class CopyPreviewService {
  constructor(private readonly offers: ShopeeOfferRepository) {}

  async preview(offerId: string) {
    const offer = await this.offers.findOfferById(offerId);
    if (!offer) throw new AppError('Oferta nao encontrada', 'OFFER_NOT_FOUND');
    const now = new Date();
    if (
      offer.unavailableAt ||
      (offer.offerEndsAt && offer.offerEndsAt <= now)
    ) {
      throw new AppError('Oferta nao esta ativa', 'OFFER_NOT_ACTIVE');
    }
    if (!offer.affiliateLink) {
      throw new AppError(
        'Oferta nao possui link afiliado',
        'AFFILIATE_LINK_REQUIRED',
      );
    }

    return {
      label: 'PREVIEW — NAO ENVIADO',
      titulo: `Oferta: ${offer.productName}`,
      mensagem: `${offer.productName} por ${currency(offer.price)}, com ${offer.discountRate}% de desconto e avaliacao ${offer.rating.toLocaleString('pt-BR')}.`,
      cta: 'Confira a oferta no link afiliado.',
      affiliateLink: offer.affiliateLink,
      coupon: null,
    };
  }
}
