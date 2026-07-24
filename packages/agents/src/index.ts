import type { OpenAIProvider, EvolutionProvider, ShopeeProvider } from '@shopee-auto-affiliate-ai/providers';
import type { Product, ScoredProduct } from '@shopee-auto-affiliate-ai/shared';

export interface Agent<I, O> { execute(input: I): Promise<O>; }
export class HunterAgent implements Agent<{ query: string }, Product[]> { constructor(private readonly shopee: ShopeeProvider) {} execute(input: { query: string }) { return this.shopee.searchProducts(input.query); } }
export class ScoreAgent implements Agent<Product, ScoredProduct> { async execute(product: Product): Promise<ScoredProduct> { return { ...product, ...calculateProductScore(product) }; } }
export class CopyAgent implements Agent<{ product: Product; tone?: string }, string> { constructor(private readonly openai: OpenAIProvider) {} execute(input: { product: Product; tone?: string }) { return this.openai.generateCopy(input); } }
export class SenderAgent implements Agent<{ to: string; message: string }, { id: string }> { constructor(private readonly evolution: EvolutionProvider) {} execute(input: { to: string; message: string }) { return this.evolution.sendMessage(input); } }
export class AnalyticsAgent implements Agent<ScoredProduct, { tracked: true; productId: string; score: number }> { async execute(product: ScoredProduct) { return { tracked: true as const, productId: product.id, score: product.score }; } }
export const calculateProductScore = (product: Product): Pick<ScoredProduct, 'score' | 'reasons'> => {
  const ratingValue = product.rating ?? product.nota ?? 0;
  const salesValue = product.sales ?? product.vendidos ?? 0;
  const commissionRawValue = product.commissionRate ?? product.comissao ?? 0;
  const commissionValue = commissionRawValue <= 1 ? commissionRawValue * 100 : commissionRawValue;
  const discountValue = product.desconto ?? 0;
  const officialStoreValue = product.loja.toLocaleLowerCase('pt-BR').includes('oficial') ? 100 : 0;

  const rating = (Math.min(Math.max(ratingValue, 0), 5) / 5) * 100;
  const sales = (Math.min(Math.max(salesValue, 0), 10000) / 10000) * 100;
  const commission = (Math.min(Math.max(commissionValue, 0), 20) / 20) * 100;
  const discount = Math.min(Math.max(discountValue, 0), 100);
  const score = Math.round(
    Math.min(
      commission * 0.35 + rating * 0.25 + sales * 0.2 + discount * 0.1 + officialStoreValue * 0.1,
      100,
    ),
  );
  const reasons = [`rating:${ratingValue}`, `sales:${salesValue}`, `commission:${commissionRawValue}`];
  return { score, reasons };
};
