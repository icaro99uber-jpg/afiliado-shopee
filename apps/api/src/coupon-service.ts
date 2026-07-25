import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  CouponData,
  CouponDiscountType,
  CouponRecord,
  CouponRepository,
} from './repositories';

const decimalPattern = /^\d+(?:\.\d{1,4})?$/;

const decimal = (value: unknown, field: string, optional = false) => {
  if (optional && (value === undefined || value === null || value === '')) {
    return null;
  }
  const normalized =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim().replace(',', '.')
        : '';
  if (!decimalPattern.test(normalized)) {
    throw new AppError(`${field} invalido`, 'INVALID_COUPON');
  }
  return normalized;
};

const optionalDate = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string') {
    throw new AppError(`${field} invalido`, 'INVALID_COUPON');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${field} invalido`, 'INVALID_COUPON');
  }
  return date;
};

export const parseManualCoupon = (
  input: Record<string, unknown>,
): CouponData => {
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const description =
    typeof input.description === 'string' ? input.description.trim() : '';
  if (!code || !description) {
    throw new AppError('Codigo e descricao sao obrigatorios', 'INVALID_COUPON');
  }
  if (!['PERCENTAGE', 'FIXED_AMOUNT'].includes(String(input.discountType))) {
    throw new AppError('Tipo de desconto invalido', 'INVALID_COUPON');
  }
  const discountType = input.discountType as CouponDiscountType;
  const discountValue = decimal(input.discountValue, 'discountValue') as string;
  if (discountType === 'PERCENTAGE' && Number(discountValue) > 100) {
    throw new AppError('Percentual nao pode exceder 100', 'INVALID_COUPON');
  }
  const startsAt = optionalDate(input.startsAt, 'startsAt');
  const endsAt = optionalDate(input.endsAt, 'endsAt');
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new AppError('Periodo do cupom invalido', 'INVALID_COUPON');
  }
  return {
    source: 'MANUAL',
    code,
    description,
    discountType,
    discountValue,
    minPurchase: decimal(input.minPurchase, 'minPurchase', true),
    maxDiscount: decimal(input.maxDiscount, 'maxDiscount', true),
    startsAt,
    endsAt,
    active: typeof input.active === 'boolean' ? input.active : true,
    shopId:
      typeof input.shopId === 'string' ? input.shopId.trim() || null : null,
    productId:
      typeof input.productId === 'string'
        ? input.productId.trim() || null
        : null,
    terms: typeof input.terms === 'string' ? input.terms.trim() || null : null,
    lastValidatedAt: new Date(),
  };
};

export const couponEligibility = (
  coupon: CouponRecord,
  purchaseAmount?: string,
  now = new Date(),
) => {
  if (!coupon.active) return { eligible: false, reason: 'INACTIVE' as const };
  if (coupon.startsAt && coupon.startsAt > now)
    return { eligible: false, reason: 'NOT_STARTED' as const };
  if (coupon.endsAt && coupon.endsAt <= now)
    return { eligible: false, reason: 'EXPIRED' as const };
  if (coupon.minPurchase) {
    if (!purchaseAmount || !decimalPattern.test(purchaseAmount)) {
      return { eligible: false, reason: 'PURCHASE_AMOUNT_REQUIRED' as const };
    }
    if (Number(purchaseAmount) < Number(coupon.minPurchase)) {
      return { eligible: false, reason: 'MIN_PURCHASE_NOT_MET' as const };
    }
  }
  return { eligible: true, reason: null };
};

export class CouponService {
  constructor(private readonly coupons: CouponRepository) {}

  list() {
    return this.coupons.list();
  }

  async find(id: string) {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new AppError('Cupom nao encontrado', 'COUPON_NOT_FOUND');
    return coupon;
  }

  create(input: Record<string, unknown>) {
    if (input.confirm !== 'CONFIRMAR_CUPOM') {
      throw new AppError(
        'Confirmacao explicita obrigatoria',
        'COUPON_CONFIRMATION_REQUIRED',
      );
    }
    const data = { ...input };
    delete data.confirm;
    return this.coupons.create(parseManualCoupon(data));
  }

  async update(id: string, input: Record<string, unknown>) {
    if (input.confirm !== 'CONFIRMAR_CUPOM') {
      throw new AppError(
        'Confirmacao explicita obrigatoria',
        'COUPON_CONFIRMATION_REQUIRED',
      );
    }
    const existing = await this.find(id);
    const changes = { ...input };
    delete changes.confirm;
    const data = parseManualCoupon({ ...existing, ...changes });
    const updated = await this.coupons.update(id, data);
    if (!updated)
      throw new AppError('Cupom nao encontrado', 'COUPON_NOT_FOUND');
    return updated;
  }

  async delete(id: string, confirm: unknown) {
    if (confirm !== 'EXCLUIR_CUPOM') {
      throw new AppError(
        'Confirmacao explicita obrigatoria',
        'COUPON_CONFIRMATION_REQUIRED',
      );
    }
    if (!(await this.coupons.delete(id))) {
      throw new AppError('Cupom nao encontrado', 'COUPON_NOT_FOUND');
    }
  }
}
