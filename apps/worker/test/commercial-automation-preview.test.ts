import { describe, expect, it, vi } from 'vitest';

import {
  loadCommercialAutomationPreviewConfig,
  runCommercialAutomationPreviewMain,
} from '../src/commercial-automation-preview';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
};

describe('commercial automation preview CLI', () => {
  it('forca preview independentemente do modo configurado', () => {
    const config = loadCommercialAutomationPreviewConfig({
      ...baseEnv,
      COMMERCIAL_AUTOMATION_MODE: 'send',
      SHOPEE_AFFILIATE_PROVIDER: 'mock',
    });

    expect(config.COMMERCIAL_AUTOMATION_MODE).toBe('preview');
    expect(config.SHOPEE_AFFILIATE_PROVIDER).toBe('mock');
  });

  it('termina com sucesso quando o runner conclui', async () => {
    const runner = vi.fn(async () => ({ status: 'preview-ready' }));

    await expect(runCommercialAutomationPreviewMain([], runner)).resolves.toBe(
      0,
    );
    expect(runner).toHaveBeenCalledWith([]);
  });

  it('falha fechado sem propagar detalhes quando o runner rejeita', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = vi.fn(async () => {
      throw new Error('secret external response');
    });

    await expect(runCommercialAutomationPreviewMain([], runner)).resolves.toBe(
      1,
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Commercial automation preview failed',
      expect.objectContaining({
        event: 'commercial-automation.preview.failed',
        code: 'COMMERCIAL_AUTOMATION_PREVIEW_FAILED',
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'secret external response',
    );
    consoleError.mockRestore();
  });
});
