import type { Product, ProductFilters } from '@shopee-auto-affiliate-ai/shared';

export interface HunterProvider {
  buscarProdutos(filters?: ProductFilters): Promise<Product[]>;
}

export interface ShopeeProvider extends HunterProvider {
  searchProducts(query: string): Promise<Product[]>;
}

export interface OpenAIProvider {
  generateCopy(input: { product: Product; tone?: string }): Promise<string>;
}

export interface EvolutionProvider {
  sendMessage(input: { to: string; message: string }): Promise<{ id: string }>;
}

const categorias = ['Eletrônicos', 'Casa', 'Beleza', 'Moda', 'Esportes', 'Pets', 'Bebês', 'Automotivo'];

const produtosBase = Array.from({ length: 40 }, (_, index) => {
  const numero = index + 1;
  const categoria = categorias[index % categorias.length];
  return {
    id: `mock-shopee-${numero.toString().padStart(2, '0')}`,
    nome: `${categoria} Produto Afiliado ${numero}`,
    categoria,
    preco: Number((29.9 + index * 7.35).toFixed(2)),
    desconto: 5 + (index % 9) * 5,
    nota: Number((4.1 + (index % 9) * 0.1).toFixed(1)),
    vendidos: 80 + index * 37,
    comissao: Number((0.04 + (index % 7) * 0.015).toFixed(3)),
    loja: `Loja Parceira ${(index % 10) + 1}`,
    urlImagem: `https://example.com/images/mock-shopee-${numero}.jpg`,
    url: `https://example.com/produto/mock-shopee-${numero}`,
  } satisfies Product;
});

const produtoAtendeFiltros = (produto: Product, filters?: ProductFilters) => {
  if (!filters) return true;
  return (
    (!filters.categoria || produto.categoria === filters.categoria) &&
    (filters.precoMin === undefined || produto.preco >= filters.precoMin) &&
    (filters.precoMax === undefined || produto.preco <= filters.precoMax) &&
    (filters.descontoMin === undefined || produto.desconto >= filters.descontoMin) &&
    (filters.notaMin === undefined || produto.nota >= filters.notaMin) &&
    (filters.vendidosMin === undefined || produto.vendidos >= filters.vendidosMin) &&
    (filters.comissaoMin === undefined || produto.comissao >= filters.comissaoMin)
  );
};

export class MockShopeeProvider implements ShopeeProvider {
  async buscarProdutos(filters?: ProductFilters) {
    return produtosBase.filter((produto) => produtoAtendeFiltros(produto, filters));
  }

  async searchProducts(query: string) {
    const normalizado = query.trim().toLocaleLowerCase('pt-BR');
    const produtos = await this.buscarProdutos();
    return normalizado
      ? produtos.filter((produto) => produto.nome.toLocaleLowerCase('pt-BR').includes(normalizado))
      : produtos;
  }
}

export class MockOpenAIProvider implements OpenAIProvider {
  async generateCopy({ product }: { product: Product }) {
    return `Oferta encontrada: ${product.nome}`;
  }
}

export class MockEvolutionProvider implements EvolutionProvider {
  async sendMessage() {
    return { id: 'mock-message' };
  }
}
