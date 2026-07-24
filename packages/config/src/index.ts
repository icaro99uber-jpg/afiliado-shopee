import { z } from 'zod';

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
  })
  .superRefine((env, context) => {
    if (env.WHATSAPP_PROVIDER !== 'evolution') return;
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
  });

export type AppEnv = z.infer<typeof envSchema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppEnv =>
  envSchema.parse(env);
