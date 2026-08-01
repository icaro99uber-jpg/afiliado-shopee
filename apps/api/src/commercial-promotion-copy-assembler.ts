import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { CommercialAiCopyOutput } from './commercial-ai-copy-provider';
import type { CommercialPromotionSignal } from './repositories';

export type AssembledCommercialPromotionCopy = {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
};

export type CommercialPromotionCopyAssemblerInput = {
  output: CommercialAiCopyOutput;
  productName: string;
  shopName: string;
  price: string;
  discountRate: number;
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  affiliateLink: string;
  maximumLength: number;
};

const formatCurrency = (value: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError(
      'Preco comercial invalido',
      'COMMERCIAL_AI_COPY_FACTS_INVALID',
    );
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
    .format(amount)
    .replace(/\u00a0/gu, ' ');
};

const formatPercent = (value: string | number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(
      'Percentual comercial invalido',
      'COMMERCIAL_AI_COPY_FACTS_INVALID',
    );
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(
    parsed,
  );
};

const extraSignalLine = (input: CommercialPromotionCopyAssemblerInput) => {
  if (input.promotionSignals.includes('PRICE_DROP')) {
    if (input.priceDropPercent === null) {
      throw new AppError(
        'Queda de preco sem percentual',
        'COMMERCIAL_AI_COPY_FACTS_INVALID',
      );
    }
    return `📉 Queda de ${formatPercent(input.priceDropPercent)}% observada desde a medição anterior.`;
  }
  if (input.promotionSignals.includes('DISCOUNT_INCREASE')) {
    return '📈 O desconto informado aumentou desde a medição anterior.';
  }
  if (input.promotionSignals.includes('NEWLY_OBSERVED')) {
    return '🆕 Oferta recém-observada pelo nosso sistema.';
  }
  return null;
};

const ANY_URL_SOURCE = String.raw`(?:[a-z][a-z0-9+.-]*://|www\.)\S+|\b(?:[\p{L}0-9-]+\.)+[\p{L}]{2,63}(?:/\S*)?`;
const ADDITIONAL_URL = new RegExp(ANY_URL_SOURCE, 'iu');
const ANY_URL = new RegExp(ANY_URL_SOURCE, 'giu');

const publicMessage = (copy: AssembledCommercialPromotionCopy) =>
  [copy.titulo, copy.mensagem, copy.cta, copy.hashtags]
    .filter(Boolean)
    .join('\n\n');

export const isSafeAssembledCommercialPromotionCopy = (
  copy: AssembledCommercialPromotionCopy,
  affiliateLink: string,
  maximumLength: number,
) => {
  try {
    const url = new URL(affiliateLink);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
  } catch {
    return false;
  }
  const message = publicMessage(copy);
  const linkOccurrences = message.split(affiliateLink).length - 1;
  return (
    message.length <= maximumLength &&
    linkOccurrences === 1 &&
    !ADDITIONAL_URL.test(message.replace(affiliateLink, ''))
  );
};

export class CommercialPromotionCopyAssembler {
  assemble(
    input: CommercialPromotionCopyAssemblerInput,
  ): AssembledCommercialPromotionCopy {
    let url: URL;
    try {
      url = new URL(input.affiliateLink);
    } catch {
      throw new AppError(
        'Link afiliado invalido',
        'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
      );
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError(
        'Link afiliado invalido',
        'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
      );
    }
    const lines = [
      input.output.body,
      `📦 Produto: ${input.productName}`,
      `🏪 Loja: ${input.shopName}`,
      `💰 Preço: ${formatCurrency(input.price)}`,
      ...(input.discountRate > 0
        ? [`💸 Desconto: ${formatPercent(input.discountRate)}%`]
        : []),
      ...(extraSignalLine(input) ? [extraSignalLine(input) as string] : []),
    ];
    const copy = {
      titulo: input.output.headline,
      mensagem: lines.join('\n'),
      cta: `${input.output.cta}\n${input.affiliateLink}`,
      hashtags: input.output.hashtags.join(' '),
    };
    const finalMessage = publicMessage(copy);
    const linkOccurrences = finalMessage.split(input.affiliateLink).length - 1;
    const messageWithoutAffiliateLink = finalMessage.replace(
      input.affiliateLink,
      '',
    );
    if (
      linkOccurrences !== 1 ||
      ADDITIONAL_URL.test(messageWithoutAffiliateLink)
    ) {
      throw new AppError(
        'Copy contem URL adicional',
        'COMMERCIAL_AI_COPY_URL_INVALID',
      );
    }
    if (finalMessage.length > input.maximumLength) {
      throw new AppError('Copy excede o limite', 'COMMERCIAL_AI_COPY_TOO_LONG');
    }
    return copy;
  }
}

export const sanitizeCommercialPromotionCopy = (
  copy: AssembledCommercialPromotionCopy,
  affiliateLink: string,
) => {
  const sanitize = (value: string) =>
    value
      .replaceAll(affiliateLink, '[LINK_AFILIADO]')
      .replace(ANY_URL, '[LINK_REMOVIDO]');
  return {
    titulo: sanitize(copy.titulo),
    mensagem: sanitize(copy.mensagem),
    cta: sanitize(copy.cta),
    hashtags: sanitize(copy.hashtags),
  };
};
