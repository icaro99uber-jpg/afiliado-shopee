import { describe, expect, it } from 'vitest';

import { envSchema } from './index';

const baseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

describe('envSchema WhatsApp provider', () => {
  it('usa mock por padrao sem exigir Evolution API', () => {
    expect(envSchema.parse(baseEnv).WHATSAPP_PROVIDER).toBe('mock');
  });

  it('valida configuracao Evolution e remove a barra final da URL', () => {
    expect(
      envSchema.parse({
        ...baseEnv,
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080///',
        EVOLUTION_API_KEY: 'test-api-key',
        EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      }).EVOLUTION_API_URL,
    ).toBe('http://localhost:8080');
  });

  it.each([
    'EVOLUTION_API_URL',
    'EVOLUTION_API_KEY',
    'EVOLUTION_INSTANCE_NAME',
  ] as const)('exige %s no modo evolution', (field) => {
    const result = envSchema.safeParse({
      ...baseEnv,
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'test-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      [field]: undefined,
    });

    expect(result.success).toBe(false);
  });
});
