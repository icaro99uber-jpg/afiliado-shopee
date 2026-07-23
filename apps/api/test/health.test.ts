import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('returns api health status', async () => {
    const app = await buildApp({ logger: false });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'api' });
    await app.close();
  });
});
