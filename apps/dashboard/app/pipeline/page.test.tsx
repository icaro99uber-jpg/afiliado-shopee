import React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, render, submit } from '../../test/render';
import PipelinePage from './page';

const runPipelineMock = vi.fn();
const getPipelineJobMock = vi.fn();

vi.mock('../../lib/api', () => ({
  runPipeline: (...args: unknown[]) => runPipelineMock(...args),
  getPipelineJob: (...args: unknown[]) => getPipelineJobMock(...args),
}));

beforeEach(() => {
  runPipelineMock.mockReset();
  getPipelineJobMock.mockReset();
  sessionStorage.clear();
});

describe('PipelinePage', () => {
  it('dispara o pipeline e consulta o job criado', async () => {
    runPipelineMock.mockResolvedValue({ jobId: 'job-1', status: 'queued' });
    getPipelineJobMock.mockResolvedValue({
      status: 'completed',
      progress: 100,
      startedAt: '2026-07-24T10:00:00.000Z',
      finishedAt: '2026-07-24T10:00:01.000Z',
      result: { ok: true },
      error: null,
    });

    const screen = await render(<PipelinePage />);
    const category = screen.container.querySelector('input[placeholder="Ex.: Eletronicos"]');
    const form = screen.container.querySelector('form');
    expect(category).not.toBeNull();
    expect(form).not.toBeNull();

    await change(category as HTMLInputElement, 'Eletronicos');
    await submit(form as HTMLFormElement);

    expect(runPipelineMock).toHaveBeenCalledWith({ categoria: 'Eletronicos' });
    expect(getPipelineJobMock).toHaveBeenCalledWith('job-1');
    expect(sessionStorage.getItem('lastPipelineJobId')).toBe('job-1');
    expect(screen.container.textContent).toContain('completed');
    await screen.unmount();
  });

  it('faz polling enquanto ativo e limpa o intervalo ao desmontar', async () => {
    vi.useFakeTimers();
    runPipelineMock.mockResolvedValue({ jobId: 'job-2', status: 'queued' });
    getPipelineJobMock.mockResolvedValue({
      status: 'active',
      progress: 30,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    });

    const screen = await render(<PipelinePage />);
    const form = screen.container.querySelector('form');
    await submit(form as HTMLFormElement);
    expect(getPipelineJobMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getPipelineJobMock).toHaveBeenCalledTimes(2);

    await screen.unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getPipelineJobMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('mostra erro quando o polling falha', async () => {
    runPipelineMock.mockResolvedValue({ jobId: 'job-3', status: 'queued' });
    getPipelineJobMock.mockRejectedValue(new Error('Job nao encontrado'));

    const screen = await render(<PipelinePage />);
    const form = screen.container.querySelector('form');
    await submit(form as HTMLFormElement);

    expect(screen.container.textContent).toContain('Job nao encontrado');
    await screen.unmount();
  });
});
