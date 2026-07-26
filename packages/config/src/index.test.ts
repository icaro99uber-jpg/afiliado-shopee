import { describe, expect, it } from 'vitest';

import { envSchema } from './index';

const baseEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
};

describe('envSchema automacao comercial', () => {
  it('usa bind local e defaults conservadores', () => {
    const config = envSchema.parse(baseEnv);

    expect(config.HOST).toBe('127.0.0.1');
    expect(config.COMMERCIAL_AUTOMATION_ENABLED).toBe(false);
    expect(config.COMMERCIAL_TIMEZONE).toBe('America/Sao_Paulo');
    expect(config.COMMERCIAL_ALLOWED_START_TIME).toBe('08:00');
    expect(config.COMMERCIAL_ALLOWED_END_TIME).toBe('20:00');
    expect(config.COMMERCIAL_DAILY_GLOBAL_LIMIT).toBe(1);
    expect(config.COMMERCIAL_DAILY_GROUP_LIMIT).toBe(1);
    expect(config.COMMERCIAL_MIN_INTERVAL_MINUTES).toBe(60);
  });

  it('permite HOST explicito sem alterar o padrao', () => {
    expect(envSchema.parse({ ...baseEnv, HOST: '0.0.0.0' }).HOST).toBe(
      '0.0.0.0',
    );
  });

  it.each(['8:00', '24:00', '12:60', 'invalid'])(
    'rejeita horario comercial invalido: %s',
    (time) => {
      expect(
        envSchema.safeParse({
          ...baseEnv,
          COMMERCIAL_ALLOWED_START_TIME: time,
        }).success,
      ).toBe(false);
    },
  );

  it('rejeita janela vazia e timezone invalido', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        COMMERCIAL_ALLOWED_START_TIME: '08:00',
        COMMERCIAL_ALLOWED_END_TIME: '08:00',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        COMMERCIAL_TIMEZONE: 'Timezone/Inexistente',
      }).success,
    ).toBe(false);
  });

  it.each([
    'COMMERCIAL_DAILY_GLOBAL_LIMIT',
    'COMMERCIAL_DAILY_GROUP_LIMIT',
    'COMMERCIAL_MIN_INTERVAL_MINUTES',
  ] as const)('rejeita %s fora do intervalo seguro', (field) => {
    expect(envSchema.safeParse({ ...baseEnv, [field]: '0' }).success).toBe(
      false,
    );
  });
});

describe('envSchema Scheduler comercial', () => {
  it('usa Scheduler desligado e preview por padrao', () => {
    const config = envSchema.parse(baseEnv);
    expect(config.COMMERCIAL_SCHEDULER_ENABLED).toBe(false);
    expect(config.COMMERCIAL_SCHEDULER_CRON).toBe('0 9 * * *');
    expect(config.COMMERCIAL_SCHEDULER_TIMEZONE).toBe('America/Sao_Paulo');
    expect(config.COMMERCIAL_AUTOMATION_MODE).toBe('preview');
  });

  it('valida cron, timezone e modo comerciais', () => {
    expect(
      envSchema.safeParse({
        ...baseEnv,
        COMMERCIAL_SCHEDULER_CRON: 'cron-invalido',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        COMMERCIAL_SCHEDULER_TIMEZONE: 'Timezone/Inexistente',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnv,
        COMMERCIAL_AUTOMATION_MODE: 'invalid',
      }).success,
    ).toBe(false);
  });

  it.each(['mock', 'manual'])(
    'bloqueia send com provider Shopee %s',
    (provider) => {
      const result = envSchema.safeParse({
        ...baseEnv,
        COMMERCIAL_AUTOMATION_MODE: 'send',
        SHOPEE_AFFILIATE_PROVIDER: provider,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message)).toContain(
          'COMMERCIAL_AUTOMATION_OFFICIAL_PROVIDER_REQUIRED',
        );
      }
    },
  );

  it('aceita send somente com configuracao oficial, Evolution e grupos seguros', () => {
    const safeSendEnv = {
      ...baseEnv,
      COMMERCIAL_AUTOMATION_MODE: 'send',
      SHOPEE_AFFILIATE_PROVIDER: 'official',
      SHOPEE_AFFILIATE_API_ENABLED: 'true',
      SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/open-api',
      SHOPEE_AFFILIATE_APP_ID: 'placeholder-app-id',
      SHOPEE_AFFILIATE_SECRET: 'placeholder-secret',
      WHATSAPP_PROVIDER: 'evolution',
      EVOLUTION_API_URL: 'http://localhost:8080',
      EVOLUTION_API_KEY: 'placeholder-api-key',
      EVOLUTION_INSTANCE_NAME: 'affiliate-bot',
      EVOLUTION_SAFE_MODE: 'true',
      WHATSAPP_GROUP_SEND_ENABLED: 'true',
      SCHEDULER_ENABLED: 'false',
    };
    const config = envSchema.parse(safeSendEnv);
    expect(config.COMMERCIAL_AUTOMATION_MODE).toBe('send');

    for (const [field, value, expectedCode] of [
      ['WHATSAPP_PROVIDER', 'mock', 'COMMERCIAL_AUTOMATION_EVOLUTION_REQUIRED'],
      ['EVOLUTION_SAFE_MODE', 'false', 'COMMERCIAL_AUTOMATION_SAFE_MODE_REQUIRED'],
      [
        'WHATSAPP_GROUP_SEND_ENABLED',
        'false',
        'COMMERCIAL_AUTOMATION_GROUP_SEND_REQUIRED',
      ],
      ['SCHEDULER_ENABLED', 'true', 'LEGACY_SCHEDULER_MUST_REMAIN_DISABLED'],
    ] as const) {
      const result = envSchema.safeParse({
        ...safeSendEnv,
        [field]: value,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message)).toContain(
          expectedCode,
        );
      }
    }
  });
});

describe('envSchema WhatsApp provider', () => {
  it('usa mock por padrao sem exigir Evolution API', () => {
    const config = envSchema.parse(baseEnv);

    expect(config.WHATSAPP_PROVIDER).toBe('mock');
    expect(config.EVOLUTION_SAFE_MODE).toBe(true);
    expect(config.EVOLUTION_ALLOWED_DESTINATIONS).toEqual([]);
    expect(config.EVOLUTION_MAX_MESSAGES_PER_BOOT).toBe(1);
    expect(config.WHATSAPP_GROUP_SEND_ENABLED).toBe(false);
    expect(config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN).toBe(1);
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

  it.each(['0', '-1', '1.5', 'invalid'])(
    'rejeita limite de grupos que nao seja inteiro positivo: %s',
    (limit) => {
      expect(
        envSchema.safeParse({
          ...baseEnv,
          WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: limit,
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

describe('envSchema Shopee Affiliate', () => {
  it('usa mock e limite baixo por padrao', () => {
    const config = envSchema.parse(baseEnv);
    expect(config.SHOPEE_AFFILIATE_PROVIDER).toBe('mock');
    expect(config.SHOPEE_AFFILIATE_API_ENABLED).toBe(false);
    expect(config.SHOPEE_AFFILIATE_SUB_ID_PREFIX).toBe('whatsapp');
    expect(config.SHOPEE_AFFILIATE_SYNC_LIMIT).toBe(20);
    expect(config.COMMERCIAL_COPY_MAX_LENGTH).toBe(1000);
  });

  it.each(['0', '-1', '1.5', 'invalid'])(
    'rejeita tamanho comercial que nao seja inteiro positivo: %s',
    (maximumLength) => {
      expect(
        envSchema.safeParse({
          ...baseEnv,
          COMMERCIAL_COPY_MAX_LENGTH: maximumLength,
        }).success,
      ).toBe(false);
    },
  );

  it('permite manual sem credenciais', () => {
    expect(
      envSchema.parse({ ...baseEnv, SHOPEE_AFFILIATE_PROVIDER: 'manual' })
        .SHOPEE_AFFILIATE_PROVIDER,
    ).toBe('manual');
  });

  it.each([
    'SHOPEE_AFFILIATE_API_ENABLED',
    'SHOPEE_AFFILIATE_API_URL',
    'SHOPEE_AFFILIATE_APP_ID',
    'SHOPEE_AFFILIATE_SECRET',
  ] as const)('exige %s no modo official', (field) => {
    const complete = {
      ...baseEnv,
      SHOPEE_AFFILIATE_PROVIDER: 'official',
      SHOPEE_AFFILIATE_API_ENABLED: 'true',
      SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/open-api',
      SHOPEE_AFFILIATE_APP_ID: 'placeholder-app-id',
      SHOPEE_AFFILIATE_SECRET: 'placeholder-secret',
    };
    expect(
      envSchema.safeParse({ ...complete, [field]: undefined }).success,
    ).toBe(false);
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
