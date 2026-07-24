import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestMock = vi.fn();

vi.mock('./client', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

import {
  listWhatsAppGroups,
  syncWhatsAppGroups,
  updateWhatsAppGroupAuthorization,
} from './whatsapp';

beforeEach(() => apiRequestMock.mockReset());

describe('API de grupos do dashboard', () => {
  it('lista com filtros seguros', async () => {
    apiRequestMock.mockResolvedValue([]);
    await listWhatsAppGroups({ active: true, available: false });
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/whatsapp/groups?active=true&available=false',
    );
  });

  it('sincroniza sem payload', async () => {
    apiRequestMock.mockResolvedValue({});
    await syncWhatsAppGroups();
    expect(apiRequestMock).toHaveBeenCalledWith('/whatsapp/groups/sync', {
      method: 'POST',
    });
  });

  it('envia confirmacao exata apenas ao autorizar', async () => {
    apiRequestMock.mockResolvedValue({});
    await updateWhatsAppGroupAuthorization('group-1', true);
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      '/whatsapp/groups/group-1',
      {
        method: 'PATCH',
        body: { active: true, confirm: 'AUTORIZAR_GRUPO' },
      },
    );
    await updateWhatsAppGroupAuthorization('group-1', false);
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      '/whatsapp/groups/group-1',
      {
        method: 'PATCH',
        body: { active: false },
      },
    );
  });
});
