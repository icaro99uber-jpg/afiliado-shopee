import React from 'react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { LoadingState } from './loading-state';
import { render } from '../test/render';

describe('componentes de estado', () => {
  it('renderiza loading, empty e erro com mensagens compreensiveis', async () => {
    const screen = await render(
      <div>
        <LoadingState label="Carregando dashboard" />
        <EmptyState title="Sem dados" description="Nada para mostrar." />
        <ErrorState message="Falha ao carregar." />
      </div>,
    );

    expect(screen.container.textContent).toContain('Carregando dashboard');
    expect(screen.container.textContent).toContain('Sem dados');
    expect(screen.container.textContent).toContain('Falha ao carregar.');
    await screen.unmount();
  });
});
