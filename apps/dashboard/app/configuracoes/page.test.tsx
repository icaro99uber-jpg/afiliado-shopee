import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import type { SchedulerStatus } from '../../lib/api';
import SettingsPage from './page';

const getHealthMock = vi.fn();
const getSchedulerStatusMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getApiBaseUrl: () => 'http://localhost:3333',
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getSchedulerStatus: (...args: unknown[]) =>
    getSchedulerStatusMock(...args),
}));

const schedulerStatus: SchedulerStatus = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduled-pipeline-product',
  queue: 'product-pipeline',
  jobName: 'pipeline-product',
  cronExpression: '0 8 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-07-25T11:00:00.000Z',
};

const flush = async () => {
  await act(async () => undefined);
};

beforeEach(() => {
  getHealthMock.mockReset().mockResolvedValue({ status: 'ok', service: 'api' });
  getSchedulerStatusMock.mockReset().mockResolvedValue(schedulerStatus);
});

describe('SettingsPage Scheduler', () => {
  it('mostra loading isolado durante a consulta', async () => {
    getSchedulerStatusMock.mockReturnValue(new Promise(() => undefined));

    const screen = await render(<SettingsPage />);

    expect(screen.container.textContent).toContain(
      'Consultando status do Scheduler',
    );
    const refreshButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar status'));
    expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
    await screen.unmount();
  });

  it.each([
    ['disabled', false, 'Desativado'],
    ['registered', true, 'Agendado'],
    ['not-registered', true, 'Não registrado'],
  ] as const)('exibe detalhes somente leitura para %s', async (
    status,
    enabled,
    label,
  ) => {
    getSchedulerStatusMock.mockResolvedValue({
      ...schedulerStatus,
      status,
      enabled,
    });

    const screen = await render(<SettingsPage />);
    await flush();

    expect(screen.container.textContent).toContain(label);
    expect(screen.container.textContent).toContain('scheduled-pipeline-product');
    expect(screen.container.textContent).toContain('product-pipeline');
    expect(screen.container.textContent).toContain('pipeline-product');
    expect(screen.container.textContent).toContain('0 8 * * *');
    expect(screen.container.textContent).toContain('America/Sao_Paulo');
    expect(screen.container.textContent).toContain('25/07/2026');
    expect(screen.container.textContent).toContain(
      'Esta tela é somente leitura',
    );
    expect(screen.container.querySelector('input, textarea, select')).toBeNull();
    expect(screen.container.textContent).not.toContain('Ativar Scheduler');
    expect(screen.container.textContent).not.toContain('Desativar Scheduler');
    await screen.unmount();
  });

  it('mostra indisponibilidade como erro e faz retry', async () => {
    getSchedulerStatusMock
      .mockRejectedValueOnce(new Error('Consulta indisponível (503)'))
      .mockResolvedValueOnce(schedulerStatus);

    const screen = await render(<SettingsPage />);
    await flush();

    expect(screen.container.textContent).toContain('Consulta indisponível (503)');
    expect(screen.container.textContent).not.toContain('Desativado');

    const retryButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Tentar novamente'));
    await click(retryButton as HTMLButtonElement);
    await flush();

    expect(getSchedulerStatusMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain('Agendado');
    await screen.unmount();
  });

  it('evita chamadas duplicadas durante atualizacao', async () => {
    const pending = new Promise<SchedulerStatus>(() => undefined);
    getSchedulerStatusMock
      .mockResolvedValueOnce(schedulerStatus)
      .mockReturnValueOnce(pending);
    const screen = await render(<SettingsPage />);
    await flush();

    const refreshButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar status'));
    await click(refreshButton as HTMLButtonElement);
    await click(refreshButton as HTMLButtonElement);

    expect(getSchedulerStatusMock).toHaveBeenCalledTimes(2);
    expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
    await screen.unmount();
  });
});
