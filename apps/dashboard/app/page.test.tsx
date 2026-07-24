import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { click, render } from '../test/render';
import type { AnalyticsSnapshot } from '../lib/api';
import OverviewPage from './page';

const getAnalyticsMock = vi.fn();
const getHealthMock = vi.fn();
const listDispatchesMock = vi.fn();

vi.mock('../lib/api', () => ({
  getAnalytics: (...args: unknown[]) => getAnalyticsMock(...args),
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
}));

const snapshot: AnalyticsSnapshot = {
  totalProducts: 40,
  totalApprovedProducts: 12,
  totalGeneratedCopies: 18,
  totalQueuedDispatches: 3,
  totalSentDispatches: 10,
  totalFailedDispatches: 6,
  totalActiveDestinations: 4,
};

const zeroSnapshot: AnalyticsSnapshot = {
  totalProducts: 0,
  totalApprovedProducts: 0,
  totalGeneratedCopies: 0,
  totalQueuedDispatches: 0,
  totalSentDispatches: 0,
  totalFailedDispatches: 0,
  totalActiveDestinations: 0,
};

const metricValue = (container: HTMLElement, title: string) => {
  const label = Array.from(container.querySelectorAll('p')).find(
    (element) => element.textContent === title,
  );
  return label?.parentElement?.textContent;
};

const flush = async () => {
  await act(async () => undefined);
};

beforeEach(() => {
  getAnalyticsMock.mockReset();
  getHealthMock.mockReset().mockResolvedValue({ status: 'ok', service: 'api' });
  listDispatchesMock.mockReset().mockResolvedValue([]);
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OverviewPage Analytics', () => {
  it('mostra loading enquanto o snapshot esta pendente', async () => {
    getAnalyticsMock.mockReturnValue(new Promise(() => undefined));

    const screen = await render(<OverviewPage />);

    expect(screen.container.textContent).toContain(
      'Carregando metricas operacionais',
    );
    await screen.unmount();
  });

  it('substitui indicadores indisponiveis pelas sete metricas reais', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    getAnalyticsMock.mockResolvedValue(snapshot);

    const screen = await render(<OverviewPage />);
    await flush();

    expect(metricValue(screen.container, 'Produtos encontrados')).toContain('40');
    expect(metricValue(screen.container, 'Produtos aprovados')).toContain('12');
    expect(metricValue(screen.container, 'Copies geradas')).toContain('18');
    expect(metricValue(screen.container, 'Envios enfileirados')).toContain('3');
    expect(metricValue(screen.container, 'Envios enviados')).toContain('10');
    expect(metricValue(screen.container, 'Envios com falha')).toContain('6');
    expect(metricValue(screen.container, 'Destinos ativos')).toContain('4');
    expect(screen.container.textContent).not.toContain('Produtos pontuados');
    expect(screen.container.textContent).not.toContain('indisponivel');
    expect(fetchMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('exibe zero para um snapshot sem registros', async () => {
    getAnalyticsMock.mockResolvedValue(zeroSnapshot);

    const screen = await render(<OverviewPage />);
    await flush();

    for (const title of [
      'Produtos encontrados',
      'Produtos aprovados',
      'Copies geradas',
      'Envios enfileirados',
      'Envios enviados',
      'Envios com falha',
      'Destinos ativos',
    ]) {
      expect(metricValue(screen.container, title)).toContain('0');
    }
    await screen.unmount();
  });

  it('isola o erro de Analytics e atualiza os dados apos retry', async () => {
    getAnalyticsMock
      .mockRejectedValueOnce(new Error('Analytics indisponivel'))
      .mockResolvedValueOnce(snapshot);

    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Analytics indisponivel');
    expect(screen.container.textContent).toContain('Estado da API');

    const retryButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Tentar novamente'));
    expect(retryButton).toBeDefined();

    await click(retryButton as HTMLButtonElement);
    await flush();

    expect(getAnalyticsMock).toHaveBeenCalledTimes(2);
    expect(metricValue(screen.container, 'Envios com falha')).toContain('6');
    expect(screen.container.textContent).not.toContain('Analytics indisponivel');
    await screen.unmount();
  });

  it('permite atualizar as metricas manualmente sem polling permanente', async () => {
    getAnalyticsMock
      .mockResolvedValueOnce(zeroSnapshot)
      .mockResolvedValueOnce(snapshot);

    const screen = await render(<OverviewPage />);
    await flush();

    const refreshButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar metricas'));
    expect(refreshButton).toBeDefined();

    await click(refreshButton as HTMLButtonElement);
    await flush();

    expect(getAnalyticsMock).toHaveBeenCalledTimes(2);
    expect(metricValue(screen.container, 'Produtos encontrados')).toContain('40');
    await screen.unmount();
  });
});
