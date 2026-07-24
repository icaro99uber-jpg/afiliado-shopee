import { listDispatches } from './whatsapp';
import type { DashboardProduct } from './types';

export const listProductsFromDispatches = async () => {
  const dispatches = await listDispatches();
  const products = new Map<string, DashboardProduct>();

  for (const dispatch of dispatches) {
    if (dispatch.product && !products.has(dispatch.productId)) {
      products.set(dispatch.productId, {
        ...dispatch.product,
        id: dispatch.productId,
      });
    }
  }

  return Array.from(products.values());
};

