import { apiRequest } from './client';
import type {
  DispatchFilters,
  WhatsAppDestination,
  WhatsAppDestinationInput,
  WhatsAppDispatch,
  WhatsAppGroup,
  WhatsAppGroupFilters,
  WhatsAppGroupSyncReport,
} from './types';

const toQuery = (filters: DispatchFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.destinationId) params.set('destinationId', filters.destinationId);
  if (filters.productId) params.set('productId', filters.productId);
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const listDestinations = () =>
  apiRequest<WhatsAppDestination[]>('/whatsapp/destinations');

export const createDestination = (input: WhatsAppDestinationInput) =>
  apiRequest<WhatsAppDestination>('/whatsapp/destinations', {
    method: 'POST',
    body: input,
  });

export const updateDestination = (
  id: string,
  input: Partial<WhatsAppDestinationInput>,
) =>
  apiRequest<WhatsAppDestination>(
    `/whatsapp/destinations/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: input,
    },
  );

export const listDispatches = (filters: DispatchFilters = {}) =>
  apiRequest<WhatsAppDispatch[]>(`/whatsapp/dispatches${toQuery(filters)}`);

export const getDispatch = (id: string) =>
  apiRequest<WhatsAppDispatch>(
    `/whatsapp/dispatches/${encodeURIComponent(id)}`,
  );

const groupFiltersToQuery = (filters: WhatsAppGroupFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.active !== undefined)
    params.set('active', String(filters.active));
  if (filters.available !== undefined)
    params.set('available', String(filters.available));
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const listWhatsAppGroups = (filters: WhatsAppGroupFilters = {}) =>
  apiRequest<WhatsAppGroup[]>(
    `/whatsapp/groups${groupFiltersToQuery(filters)}`,
  );

export const syncWhatsAppGroups = () =>
  apiRequest<WhatsAppGroupSyncReport>('/whatsapp/groups/sync', {
    method: 'POST',
  });

export const updateWhatsAppGroupAuthorization = (id: string, active: boolean) =>
  apiRequest<WhatsAppGroup>(`/whatsapp/groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: active ? { active, confirm: 'AUTORIZAR_GRUPO' } : { active },
  });
