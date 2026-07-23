export type Product = {
  id: string;
  nome: string;
  categoria: string;
  preco: number;
  desconto: number;
  nota: number;
  vendidos: number;
  comissao: number;
  loja: string;
  urlImagem: string;
  url?: string;
  title?: string;
  price?: number;
  rating?: number;
  sales?: number;
  commissionRate?: number;
};

export type ProductFilters = {
  categoria?: string;
  precoMin?: number;
  precoMax?: number;
  descontoMin?: number;
  notaMin?: number;
  vendidosMin?: number;
  comissaoMin?: number;
};

export type ScoredProduct = Product & { score: number; reasons: string[] };

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code = 'APP_ERROR',
  ) {
    super(message);
  }
}

export const nowIso = () => new Date().toISOString();
