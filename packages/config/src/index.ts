import { z } from 'zod';
export const envSchema = z.object({ NODE_ENV: z.enum(['development','test','production']).default('development'), PORT: z.coerce.number().default(3333), DATABASE_URL: z.string().url(), REDIS_URL: z.string().url(), OPENAI_API_KEY: z.string().optional(), SHOPEE_PARTNER_ID: z.string().optional(), SHOPEE_PARTNER_KEY: z.string().optional(), EVOLUTION_API_URL: z.string().url().optional(), EVOLUTION_API_KEY: z.string().optional() });
export type AppEnv = z.infer<typeof envSchema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppEnv => envSchema.parse(env);
