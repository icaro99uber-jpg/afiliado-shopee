import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import CommercialPipelinePage from './page';

const listMock = vi.fn();
const runMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCommercialPipelineRuns: (...args: unknown[]) => listMock(...args),
  runCommercialPipelineDryRun: (...args: unknown[]) => runMock(...args),
}));

const result = {
  runId: 'run-safe',
  mode: 'dry-run',
  status: 'ready',
  provider: 'mock',
  candidateCount: 3,
  eligibleCount: 1,
  rejectedCount: 2,
  rejectionSummary: {
    MISSING_AFFILIATE_LINK: 1,
    SCORE_BELOW_MINIMUM: 1,
  },
  selectedProduct: {
    id: 'product-safe',
    name: 'Produto ficticio selecionado',
    price: '99.90',
    score: 82,
    affiliateLinkPresent: true,
  },
  selectedGroup: {
    id: 'group-safe',
    name: 'Grupo ficticio autorizado',
    fingerprint: 'grp_123456789abc',
  },
  selectionReasons: ['Maior score elegivel: 82'],
  copyPreview:
    '🔥 Oferta encontrada!\n\n📦 Produto ficticio selecionado\n\n💰 Por R$ 99,90\n\n🛒 Aproveite pelo link:\nhttps://example.invalid/affiliate',
  plannedSubIds: [
    'whatsapp',
    'whatsapp',
    'grp_123456789abc',
    'teste-local',
    '2026-07-25',
  ],
  dispatchWillBeCreated: false,
  jobWillBeCreated: false,
  messageWillBeSent: false,
};

const history = {
  id: 'run-safe',
  mode: 'dry-run',
  status: 'completed',
  selectedProduct: result.selectedProduct,
  selectedGroup: result.selectedGroup,
  candidateCount: 3,
  eligibleCount: 1,
  rejectedCount: 2,
  rejectionSummary: result.rejectionSummary,
  selectionReasons: result.selectionReasons,
  copyPreview: result.copyPreview,
  plannedSubIds: result.plannedSubIds,
  failureCode: null,
  createdAt: '2026-07-25T12:00:00.000Z',
  completedAt: '2026-07-25T12:00:01.000Z',
  dispatchWasCreated: false,
  jobWasCreated: false,
  messageWasSent: false,
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({
    items: [history],
    page: 1,
    limit: 10,
    total: 1,
    totalPages: 1,
  });
  runMock.mockReset().mockResolvedValue(result);
});

const executeButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Executar dry-run'),
  ) as HTMLButtonElement;

describe('CommercialPipelinePage', () => {
  it('mostra loading inicial e historico sanitizado', async () => {
    let release: (value: unknown) => void = () => undefined;
    listMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const screen = await render(<CommercialPipelinePage />);
    expect(screen.container.textContent).toContain('Carregando historico');
    await act(async () => {
      release({ items: [], page: 1, limit: 10, total: 0, totalPages: 1 });
    });
    await screen.unmount();
  });

  it('executa e apresenta produto, grupo, preview e resumo', async () => {
    const screen = await render(<CommercialPipelinePage />);
    await click(executeButton(screen.container));
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'MOCK',
        minimumScore: 70,
        campaign: 'teste-local',
      }),
    );
    const text = screen.container.textContent ?? '';
    expect(text).toContain('Produto ficticio selecionado');
    expect(text).toContain('Score 82');
    expect(text).toContain('Grupo ficticio autorizado');
    expect(text).toContain('grp_123456789abc');
    expect(text).toContain('Copiar preview');
    expect(text).toContain('Sem link afiliado');
    expect(text).toContain('Nenhuma mensagem foi enviada');
    expect(text).not.toContain('Enviar mensagem');
    expect(text).not.toContain('Confirmar envio');
    await screen.unmount();
  });

  it('exibe historico de dry-runs', async () => {
    const screen = await render(<CommercialPipelinePage />);
    expect(screen.container.textContent).toContain('Historico de dry-runs');
    expect(screen.container.textContent).toContain(
      'Produto ficticio selecionado',
    );
    expect(screen.container.textContent).not.toContain('@g.us');
    await screen.unmount();
  });

  it('mostra erro de zero candidatos e permite retry', async () => {
    runMock
      .mockRejectedValueOnce(new Error('Nenhum produto elegivel encontrado'))
      .mockResolvedValueOnce(result);
    const screen = await render(<CommercialPipelinePage />);
    await click(executeButton(screen.container));
    expect(screen.container.textContent).toContain(
      'Nenhum produto elegivel encontrado',
    );
    const retry = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Tentar novamente',
    ) as HTMLButtonElement;
    await click(retry);
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain(
      'Produto ficticio selecionado',
    );
    await screen.unmount();
  });

  it('mostra bloqueio por multiplos grupos sem acao de envio', async () => {
    runMock.mockRejectedValueOnce(
      new Error('Mais de um grupo autorizado esta disponivel'),
    );
    const screen = await render(<CommercialPipelinePage />);
    await click(executeButton(screen.container));
    expect(screen.container.textContent).toContain(
      'Mais de um grupo autorizado esta disponivel',
    );
    expect(screen.container.textContent).not.toContain('Enviar mensagem');
    await screen.unmount();
  });

  it('mantem layouts explicitos para mobile e desktop', async () => {
    const screen = await render(<CommercialPipelinePage />);
    expect(
      screen.container.querySelector('[class*="sm:grid-cols-2"]'),
    ).not.toBeNull();
    expect(
      screen.container.querySelector('[class*="lg:grid-cols-4"]'),
    ).not.toBeNull();
    expect(screen.container.textContent).toContain(
      'Cupons nao fazem parte deste fluxo',
    );
    await screen.unmount();
  });
});
