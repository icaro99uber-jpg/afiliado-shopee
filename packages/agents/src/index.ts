import type { OpenAIProvider, EvolutionProvider, ShopeeProvider } from '@shopee-auto-affiliate-ai/providers';
import type { Product, ScoredProduct } from '@shopee-auto-affiliate-ai/shared';

export interface Agent<I, O> { execute(input: I): Promise<O>; }
export class HunterAgent implements Agent<{ query: string }, Product[]> { constructor(private readonly shopee: ShopeeProvider) {} execute(input: { query: string }) { return this.shopee.searchProducts(input.query); } }
export class ScoreAgent implements Agent<Product, ScoredProduct> { async execute(product: Product): Promise<ScoredProduct> { return { ...product, ...calculateProductScore(product) }; } }
export class CopyAgent implements Agent<{ product: Product; tone?: string }, string> { constructor(private readonly openai: OpenAIProvider) {} execute(input: { product: Product; tone?: string }) { return this.openai.generateCopy(input); } }
export class SenderAgent implements Agent<{ to: string; message: string }, { id: string }> { constructor(private readonly evolution: EvolutionProvider) {} execute(input: { to: string; message: string }) { return this.evolution.sendMessage(input); } }
export class AnalyticsAgent implements Agent<ScoredProduct, { tracked: true; productId: string; score: number }> { async execute(product: ScoredProduct) { return { tracked: true, productId: product.id, score: product.score }; } }
export const calculateProductScore = (product: Product): Pick<ScoredProduct, 'score' | 'reasons'> => {
  const ratingValue = product.rating ?? product.nota ?? 0;
  const salesValue = product.sales ?? product.vendidos ?? 0;
  const commissionValue = product.commissionRate ?? product.comissao ?? 0;
  const priceValue = product.price ?? product.preco;
  const rating = Math.min(ratingValue, 5) * 20;
  const sales = Math.min(salesValue, 500) / 5;
  const commission = Math.min(commissionValue, 0.2) * 500;
  const affordability = priceValue <= 100 ? 10 : priceValue <= 250 ? 5 : 0;
  const score = Math.round(Math.min(rating * 0.35 + sales * 0.3 + commission * 0.25 + affordability, 100));
  const reasons = [`rating:${ratingValue}`, `sales:${salesValue}`, `commission:${commissionValue}`];
  return { score, reasons };
};
