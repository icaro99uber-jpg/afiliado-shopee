import type { Product } from '@shopee-auto-affiliate-ai/shared';
export interface ShopeeProvider { searchProducts(query: string): Promise<Product[]>; }
export interface OpenAIProvider { generateCopy(input: { product: Product; tone?: string }): Promise<string>; }
export interface EvolutionProvider { sendMessage(input: { to: string; message: string }): Promise<{ id: string }>; }
export class MockShopeeProvider implements ShopeeProvider { async searchProducts(query: string) { return [{ id: 'mock-1', title: `Produto mock ${query}`, price: 99.9, rating: 4.8, sales: 120, commissionRate: 0.08 }]; } }
export class MockOpenAIProvider implements OpenAIProvider { async generateCopy({ product }: { product: Product }) { return `Oferta encontrada: ${product.title}`; } }
export class MockEvolutionProvider implements EvolutionProvider { async sendMessage() { return { id: 'mock-message' }; } }
