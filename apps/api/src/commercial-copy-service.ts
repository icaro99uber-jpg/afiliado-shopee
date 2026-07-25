import { AppError } from '@shopee-auto-affiliate-ai/shared';

export type CommercialCopyInput = {
  productName: string;
  price: string;
  discountRate: number;
  shopName: string;
  affiliateLink: string;
};

export interface CommercialCopyGenerator {
  generate(input: CommercialCopyInput): string;
}

const formatCurrency = (value: string) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
    .format(Number(value))
    .replace(/\u00a0/g, ' ');

export class CommercialCopyService implements CommercialCopyGenerator {
  constructor(private readonly maximumLength = 1000) {}

  generate(input: CommercialCopyInput): string {
    const discount =
      input.discountRate > 0
        ? `\n\n💸 ${input.discountRate.toLocaleString('pt-BR')}% de desconto`
        : '';
    const preview = [
      '🔥 Oferta encontrada!',
      '',
      `📦 ${input.productName}`,
      `🏪 ${input.shopName}`,
      '',
      `💰 Por ${formatCurrency(input.price)}${discount}`,
      '',
      '🛒 Aproveite pelo link:',
      input.affiliateLink,
    ].join('\n');

    if (preview.length > this.maximumLength) {
      throw new AppError(
        'Preview excede o tamanho maximo configurado',
        'COMMERCIAL_COPY_TOO_LONG',
      );
    }
    return preview;
  }
}
