import { apiRequest } from './client';
import type { Coupon, ManualCouponInput } from './types';

export const listCoupons = () => apiRequest<Coupon[]>('/coupons');

export const createManualCoupon = (input: ManualCouponInput) =>
  apiRequest<Coupon>('/coupons', {
    method: 'POST',
    body: { ...input, source: 'MANUAL', confirm: 'CONFIRMAR_CUPOM' },
  });

export const updateManualCoupon = (
  id: string,
  input: Partial<ManualCouponInput>,
) =>
  apiRequest<Coupon>(`/coupons/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input, confirm: 'CONFIRMAR_CUPOM' },
  });

export const deleteManualCoupon = (id: string) =>
  apiRequest<void>(`/coupons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: { confirm: 'EXCLUIR_CUPOM' },
  });
