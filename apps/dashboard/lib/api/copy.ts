import { apiRequest } from './client';
import type { CopyResponse } from './types';

export const generateCopy = (productId: string) =>
  apiRequest<CopyResponse>('/copy/generate', {
    method: 'POST',
    body: { productId },
  });

