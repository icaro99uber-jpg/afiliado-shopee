import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render, submit } from '../../test/render';
import WhatsAppPage from './page';

const listDestinationsMock = vi.fn();
const listDispatchesMock = vi.fn();
const createDestinationMock = vi.fn();
const updateDestinationMock = vi.fn();
const getDispatchMock = vi.fn();
const listWhatsAppGroupsMock = vi.fn();
const syncWhatsAppGroupsMock = vi.fn();
const updateWhatsAppGroupAuthorizationMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listDestinations: (...args: unknown[]) => listDestinationsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  createDestination: (...args: unknown[]) => createDestinationMock(...args),
  updateDestination: (...args: unknown[]) => updateDestinationMock(...args),
  getDispatch: (...args: unknown[]) => getDispatchMock(...args),
  listWhatsAppGroups: (...args: unknown[]) => listWhatsAppGroupsMock(...args),
  syncWhatsAppGroups: (...args: unknown[]) => syncWhatsAppGroupsMock(...args),
  updateWhatsAppGroupAuthorization: (...args: unknown[]) =>
    updateWhatsAppGroupAuthorizationMock(...args),
}));

beforeEach(() => {
  listDestinationsMock.mockReset();
  listDispatchesMock.mockReset();
  createDestinationMock.mockReset();
  updateDestinationMock.mockReset();
  getDispatchMock.mockReset();
  listWhatsAppGroupsMock.mockReset();
  syncWhatsAppGroupsMock.mockReset();
  updateWhatsAppGroupAuthorizationMock.mockReset();
  listDestinationsMock.mockResolvedValue([]);
  listDispatchesMock.mockResolvedValue([]);
  listWhatsAppGroupsMock.mockResolvedValue([]);
  syncWhatsAppGroupsMock.mockResolvedValue({
    discovered: 0,
    created: 0,
    updated: 0,
    unavailable: 0,
    active: 0,
  });
});

describe('WhatsAppPage', () => {
  const findButton = (container: Element, label: string) =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(label),
    ) as HTMLButtonElement;

  it('cria destino sem chamada real', async () => {
    createDestinationMock.mockResolvedValue({
      id: 'dest-1',
      name: 'Grupo',
      destination: 'mock-group-01',
      active: true,
    });

    const screen = await render(<WhatsAppPage />);
    const inputs = screen.container.querySelectorAll('input');
    await change(inputs[0], 'Grupo');
    await change(inputs[1], 'mock-group-01');
    await submit(screen.container.querySelector('form') as HTMLFormElement);

    expect(createDestinationMock).toHaveBeenCalledWith({
      name: 'Grupo',
      destination: 'mock-group-01',
      active: true,
    });
    await screen.unmount();
  });

  it('aplica filtros de dispatches', async () => {
    const screen = await render(<WhatsAppPage />);
    const forms = screen.container.querySelectorAll('form');
    const statusSelect = forms[1].querySelector('select');
    const productInput = forms[1].querySelectorAll('input')[1];

    await change(statusSelect as HTMLSelectElement, 'FAILED');
    await change(productInput, 'product-1');
    await submit(forms[1]);

    expect(listDispatchesMock).toHaveBeenLastCalledWith({
      status: 'FAILED',
      destinationId: '',
      productId: 'product-1',
    });
    await screen.unmount();
  });

  it('mostra estado vazio seguro de grupos', async () => {
    const screen = await render(<WhatsAppPage />);
    expect(screen.container.textContent).toContain(
      'Esta conta ainda não participa de nenhum grupo disponível.',
    );
    expect(screen.container.textContent).toContain(
      'não envia mensagens nem altera participantes',
    );
    await screen.unmount();
  });

  it('sincroniza grupos sem acao de envio', async () => {
    syncWhatsAppGroupsMock.mockResolvedValue({
      discovered: 1,
      created: 1,
      updated: 0,
      unavailable: 0,
      active: 0,
    });
    const screen = await render(<WhatsAppPage />);
    await click(findButton(screen.container, 'Sincronizar grupos'));
    expect(syncWhatsAppGroupsMock).toHaveBeenCalledOnce();
    expect(listWhatsAppGroupsMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain('Sincronização concluída');
    expect(screen.container.textContent).not.toContain('Enviar para grupo');
    await screen.unmount();
  });

  it('renderiza lista responsiva somente com metadados seguros', async () => {
    listWhatsAppGroupsMock.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Grupo controlado',
        fingerprint: 'grp_0123456789ab',
        memberCount: 4,
        ownerIsParticipant: null,
        active: false,
        available: true,
        discoveredAt: '2026-07-24T12:00:00.000Z',
        lastSyncedAt: '2026-07-24T12:00:00.000Z',
        updatedAt: null,
      },
    ]);
    const screen = await render(<WhatsAppPage />);
    expect(
      screen.container.querySelector('.md\\:hidden')?.textContent,
    ).toContain('Grupo controlado');
    expect(
      screen.container.querySelector('.md\\:block')?.textContent,
    ).toContain('grp_0123456789ab');
    expect(screen.container.textContent).not.toContain('@g.us');
    expect(screen.container.textContent).not.toContain('participants');
    await screen.unmount();
  });

  it('exige confirmacao visual antes de autorizar', async () => {
    const group = {
      id: 'group-1',
      name: 'Grupo controlado',
      fingerprint: 'grp_0123456789ab',
      memberCount: 4,
      ownerIsParticipant: null,
      active: false,
      available: true,
      discoveredAt: '2026-07-24T12:00:00.000Z',
      lastSyncedAt: '2026-07-24T12:00:00.000Z',
      updatedAt: null,
    };
    listWhatsAppGroupsMock.mockResolvedValue([group]);
    updateWhatsAppGroupAuthorizationMock.mockResolvedValue({
      ...group,
      active: true,
    });
    const screen = await render(<WhatsAppPage />);
    await click(findButton(screen.container, 'Autorizar'));
    expect(updateWhatsAppGroupAuthorizationMock).not.toHaveBeenCalled();
    expect(
      screen.container.querySelector('[role="alertdialog"]'),
    ).not.toBeNull();
    await click(findButton(screen.container, 'Confirmar autorização'));
    expect(updateWhatsAppGroupAuthorizationMock).toHaveBeenCalledWith(
      'group-1',
      true,
    );
    await screen.unmount();
  });

  it('desabilita autorizacao de grupo indisponivel', async () => {
    listWhatsAppGroupsMock.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Grupo indisponível',
        fingerprint: 'grp_0123456789ab',
        memberCount: null,
        ownerIsParticipant: null,
        active: false,
        available: false,
        discoveredAt: '2026-07-24T12:00:00.000Z',
        lastSyncedAt: '2026-07-24T12:00:00.000Z',
        updatedAt: null,
      },
    ]);
    const screen = await render(<WhatsAppPage />);
    expect(findButton(screen.container, 'Autorizar').disabled).toBe(true);
    await screen.unmount();
  });
});
