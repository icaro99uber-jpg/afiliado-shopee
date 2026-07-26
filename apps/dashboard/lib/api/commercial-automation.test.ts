import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCommercialAutomationStatus,
  pauseCommercialAutomation,
  resumeCommercialAutomation,
} from './commercial-automation';

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response({ allowed: false })),
  );
});

describe('commercial automation API', () => {
  it('consulta o status operacional', async () => {
    await getCommercialAutomationStatus();

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3333/commercial-automation/status',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('envia somente paused ao pausar', async () => {
    await pauseCommercialAutomation();

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3333/commercial-automation/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ paused: true }),
      }),
    );
  });

  it('envia confirmacao explicita ao retomar', async () => {
    await resumeCommercialAutomation('RETOMAR_AUTOMACAO_COMERCIAL');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3333/commercial-automation/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          paused: false,
          confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
        }),
      }),
    );
  });
});
