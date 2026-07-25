import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import CouponsPage from './page';

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCoupons: (...args: unknown[]) => listMock(...args),
  createManualCoupon: (...args: unknown[]) => createMock(...args),
  updateManualCoupon: (...args: unknown[]) => updateMock(...args),
  deleteManualCoupon: (...args: unknown[]) => deleteMock(...args),
}));

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([]);
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
});

describe('CouponsPage', () => {
  it('mostra estado manual seguro sem coleta automatica', async () => {
    const screen = await render(<CouponsPage />);
    expect(screen.container.textContent).toContain('Cupons manuais');
    expect(screen.container.textContent).toContain('Nao ha coleta automatica');
    expect(screen.container.textContent).toContain('Nenhum cupom cadastrado');
    await screen.unmount();
  });
});
