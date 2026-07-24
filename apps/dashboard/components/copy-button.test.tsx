import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';
import { click, render } from '../test/render';

describe('CopyButton', () => {
  it('copia o conteudo para a area de transferencia', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const screen = await render(<CopyButton value="mensagem" />);
    const button = screen.container.querySelector('button');
    expect(button).not.toBeNull();

    await click(button as HTMLButtonElement);

    expect(writeText).toHaveBeenCalledWith('mensagem');
    expect(screen.container.textContent).toContain('Copiado');
    await screen.unmount();
  });
});
