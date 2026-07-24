import { describe, expect, it } from 'vitest';

import { envSchema } from './index';

const baseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

describe('envSchema WhatsApp provider', () => {
  it('usa mock por padrao sem exigir Evolution API', () => {
    const config = envSchema.parse(baseEnv);

    expect(config.WHATSAPP_PROVIDER).toBe('mock');
    expect(config.EVOLUTION_SAFE_MODE).toBe(true);
    expect(config.EVOLUTION_ALLOWED_DESTINATIONS).toEqual([]);
    expect(config.EVOLUTION_MAX_MESSAGES_PER_BOOT).toBe(1);
  });

  it('separa e limpa a allowlist sem expor valores', () => {
    const config = envSchema.parse({
      ...baseEnv,
      EVOLUTION_ALLOWED_DESTINATIONS: ' 0000000000000,0000111111111 ',
    });

    expect(config.EVOLUTION_ALLOWED_DESTINATIONS).toHaveLength(2);
  });

  it.each(['0', '-1', '1.5', 'invalid'])(
    'rejeita limite que nao seja inteiro positivo: %s',
    (limit) => {
      expect(
        envSchema.safeParse({
          ...baseEnv,
          EVOLUTION_MAX_MESSAGES_PER_BOOT: limit,
        }).success,
      ).toBe(false);
    },
  );

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

describe('envSchema Scheduler', () => {
  it('mantem o scheduler desativado por padrao', () => {
    const config = envSchema.parse(baseEnv);

    expect(config.SCHEDULER_ENABLED).toBe(false);
    expect(config.SCHEDULER_CRON).toBeUndefined();
    expect(config.SCHEDULER_TIMEZONE).toBeUndefined();
  });

  it.each([undefined, 'cron-invalido', '60 8 * * *'])(
    'exige cron valido quando habilitado: %s',
    (cronExpression) => {
      const result = envSchema.safeParse({
        ...baseEnv,
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_CRON: cronExpression,
        SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
      });

      expect(result.success).toBe(false);
    },
  );

  it('rejeita timezone invalido quando habilitado', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      SCHEDULER_ENABLED: 'true',
      SCHEDULER_CRON: '0 8 * * *',
      SCHEDULER_TIMEZONE: 'Timezone/Inexistente',
    });

    expect(result.success).toBe(false);
  });

  it('aceita cron e timezone validos quando habilitado', () => {
    const config = envSchema.parse({
      ...baseEnv,
      SCHEDULER_ENABLED: 'true',
      SCHEDULER_CRON: '0 8 * * *',
      SCHEDULER_TIMEZONE: 'America/Sao_Paulo',
    });

    expect(config.SCHEDULER_ENABLED).toBe(true);
    expect(config.SCHEDULER_CRON).toBe('0 8 * * *');
    expect(config.SCHEDULER_TIMEZONE).toBe('America/Sao_Paulo');
  });
});
