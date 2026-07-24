import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());

const cronRanges = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

const isCronNumberInRange = (
  value: string,
  [minimum, maximum]: readonly [number, number],
) => {
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return number >= minimum && number <= maximum;
};

const isValidCronField = (
  field: string,
  range: readonly [number, number],
) =>
  field.split(',').every((segment) => {
    const [base, step, extra] = segment.split('/');
    if (extra !== undefined || !base) return false;
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) {
      return false;
    }
    if (base === '*') return true;

    const [start, end, extraRange] = base.split('-');
    if (extraRange !== undefined || !start) return false;
    if (end === undefined) return isCronNumberInRange(start, range);
    return (
      isCronNumberInRange(start, range) &&
      isCronNumberInRange(end, range) &&
      Number(start) <= Number(end)
    );
  });

const isValidCronExpression = (value: string) => {
  const fields = value.trim().split(/\s+/);
  return (
    fields.length === cronRanges.length &&
    fields.every((field, index) =>
      isValidCronField(field, cronRanges[index]),
    )
  );
};

const isValidTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(3333),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    OPENAI_API_KEY: z.string().optional(),
    SHOPEE_PARTNER_ID: z.string().optional(),
    SHOPEE_PARTNER_KEY: z.string().optional(),
    WHATSAPP_PROVIDER: z.enum(['mock', 'evolution']).default('mock'),
    EVOLUTION_API_URL: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, ''))
      .optional(),
    EVOLUTION_API_KEY: z.string().trim().optional(),
    EVOLUTION_INSTANCE_NAME: z.string().trim().optional(),
    SCHEDULER_ENABLED: booleanFromEnv.default(false),
    SCHEDULER_CRON: z.string().trim().optional(),
    SCHEDULER_TIMEZONE: z.string().trim().optional(),
  })
  .superRefine((env, context) => {
    if (env.WHATSAPP_PROVIDER === 'evolution') {
      for (const field of [
        'EVOLUTION_API_URL',
        'EVOLUTION_API_KEY',
        'EVOLUTION_INSTANCE_NAME',
      ] as const) {
        if (!env[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} e obrigatoria quando WHATSAPP_PROVIDER=evolution`,
          });
        }
      }
    }

    if (env.SCHEDULER_ENABLED) {
      if (!env.SCHEDULER_CRON || !isValidCronExpression(env.SCHEDULER_CRON)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SCHEDULER_CRON'],
          message:
            'SCHEDULER_CRON deve ser uma expressao cron valida com cinco campos',
        });
      }
      if (
        !env.SCHEDULER_TIMEZONE ||
        !isValidTimezone(env.SCHEDULER_TIMEZONE)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SCHEDULER_TIMEZONE'],
          message: 'SCHEDULER_TIMEZONE deve ser um timezone IANA valido',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppEnv =>
  envSchema.parse(env);
