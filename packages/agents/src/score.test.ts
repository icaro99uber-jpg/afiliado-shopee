import { describe, expect, it } from 'vitest';
import { calculateProductScore } from './index';

describe('calculateProductScore', () => {
  it('returns a bounded score with reasons', () => {
    const result = calculateProductScore({ id: '1', title: 'Oferta', price: 89, rating: 5, sales: 500, commissionRate: 0.2 });
    expect(result.score).toBe(100);
    expect(result.reasons).toContain('rating:5');
  });
});
