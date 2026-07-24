import { describe, expect, it } from 'vitest';
import { calculateProductScore } from './index';

describe('calculateProductScore', () => {
  it('returns a bounded score with reasons', () => {
    const result = calculateProductScore({
      id: '1',
      nome: 'Oferta',
      categoria: 'Eletrônicos',
      preco: 89,
      desconto: 100,
      nota: 5,
      vendidos: 500,
      comissao: 0.2,
      loja: 'Loja Oficial',
      urlImagem: 'https://example.com/image.jpg',
      title: 'Oferta',
      price: 89,
      rating: 5,
      sales: 10000,
      commissionRate: 0.2,
    });
    expect(result.score).toBe(100);
    expect(result.reasons).toContain('rating:5');
  });
});
