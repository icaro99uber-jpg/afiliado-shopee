import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  parseCommercialNicheCreate,
  parseCommercialNichePatch,
} from './commercial-niche-domain';
import type {
  CommercialNicheFilters,
  CommercialNicheRecord,
  CommercialNicheRepository,
} from './repositories';

export type CommercialNichePublic = Omit<
  CommercialNicheRecord,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string;
  updatedAt: string;
};

export const toCommercialNichePublic = (
  niche: CommercialNicheRecord,
): CommercialNichePublic => ({
  ...niche,
  createdAt: niche.createdAt.toISOString(),
  updatedAt: niche.updatedAt.toISOString(),
});

export class CommercialNicheService {
  constructor(private readonly niches: CommercialNicheRepository) {}

  async create(input: unknown) {
    return toCommercialNichePublic(
      await this.niches.create(parseCommercialNicheCreate(input)),
    );
  }

  async list(filters: CommercialNicheFilters) {
    const result = await this.niches.list(filters);
    return {
      items: result.items.map(toCommercialNichePublic),
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
    };
  }

  async find(id: string) {
    const niche = await this.niches.findById(id);
    if (!niche) {
      throw new AppError(
        'Nicho comercial nao encontrado',
        'COMMERCIAL_NICHE_NOT_FOUND',
      );
    }
    return toCommercialNichePublic(niche);
  }

  async update(id: string, input: unknown) {
    const existing = await this.niches.findById(id);
    if (!existing) {
      throw new AppError(
        'Nicho comercial nao encontrado',
        'COMMERCIAL_NICHE_NOT_FOUND',
      );
    }
    const updated = await this.niches.update(
      id,
      parseCommercialNichePatch(existing, input),
    );
    if (!updated) {
      throw new AppError(
        'Nicho comercial nao encontrado',
        'COMMERCIAL_NICHE_NOT_FOUND',
      );
    }
    return toCommercialNichePublic(updated);
  }
}
