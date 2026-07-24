import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, render, submit } from '../../test/render';
import WhatsAppPage from './page';

const listDestinationsMock = vi.fn();
const listDispatchesMock = vi.fn();
const createDestinationMock = vi.fn();
const updateDestinationMock = vi.fn();
const getDispatchMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listDestinations: (...args: unknown[]) => listDestinationsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  createDestination: (...args: unknown[]) => createDestinationMock(...args),
  updateDestination: (...args: unknown[]) => updateDestinationMock(...args),
  getDispatch: (...args: unknown[]) => getDispatchMock(...args),
}));

beforeEach(() => {
  listDestinationsMock.mockReset();
  listDispatchesMock.mockReset();
  createDestinationMock.mockReset();
  updateDestinationMock.mockReset();
  getDispatchMock.mockReset();
  listDestinationsMock.mockResolvedValue([]);
  listDispatchesMock.mockResolvedValue([]);
});

describe('WhatsAppPage', () => {
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
});
