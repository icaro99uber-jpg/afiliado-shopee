import { describe, expect, it } from 'vitest';
import { CouponService, couponEligibility } from '../src/coupon-service';
import type {
  CouponData,
  CouponRecord,
  CouponRepository,
} from '../src/repositories';

class MemoryCoupons implements CouponRepository {
  store = new Map<string, CouponRecord>();
  async create(data: CouponData) {
    const now = new Date();
    const record = { ...data, id: 'coupon-1', createdAt: now, updatedAt: now };
    this.store.set(record.id, record);
    return record;
  }
  async list() {
    return [...this.store.values()];
  }
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async update(id: string, data: Partial<CouponData>) {
    const current = this.store.get(id);
    if (!current) return null;
    const updated = { ...current, ...data, updatedAt: new Date() };
    this.store.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    return this.store.delete(id);
  }
}

const input = {
  code: 'FICTICIO10',
  description: 'Cupom ficticio',
  discountType: 'PERCENTAGE',
  discountValue: '10',
  minPurchase: '100',
  active: true,
  confirm: 'CONFIRMAR_CUPOM',
};

describe('CouponService', () => {
  it('exige confirmacao manual e nunca inventa codigo', async () => {
    const service = new CouponService(new MemoryCoupons());
    expect(() => service.create({ ...input, confirm: undefined })).toThrow();
    await expect(service.create(input)).resolves.toMatchObject({
      source: 'MANUAL',
      code: 'FICTICIO10',
    });
  });

  it('rejeita cupom vencido, inativo e compra abaixo do minimo', async () => {
    const service = new CouponService(new MemoryCoupons());
    const coupon = await service.create(input);
    expect(couponEligibility(coupon)).toMatchObject({
      eligible: false,
      reason: 'PURCHASE_AMOUNT_REQUIRED',
    });
    expect(couponEligibility(coupon, '99')).toMatchObject({
      eligible: false,
      reason: 'MIN_PURCHASE_NOT_MET',
    });
    expect(couponEligibility(coupon, '100')).toMatchObject({ eligible: true });
    expect(
      couponEligibility({ ...coupon, active: false }, '100'),
    ).toMatchObject({ reason: 'INACTIVE' });
    expect(
      couponEligibility({ ...coupon, endsAt: new Date('2020-01-01') }, '100'),
    ).toMatchObject({ reason: 'EXPIRED' });
  });
});
