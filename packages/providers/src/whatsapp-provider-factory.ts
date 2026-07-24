import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  EvolutionApiWhatsAppProvider,
  type HttpClient,
  type ProviderLogger,
} from './evolution-api-whatsapp-provider';
import { MockWhatsAppProvider, type WhatsAppProvider } from './index';

export type WhatsAppProviderFactoryConfig = {
  WHATSAPP_PROVIDER?: 'mock' | 'evolution';
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_INSTANCE_NAME?: string;
};

export type WhatsAppProviderFactoryOptions = {
  httpClient?: HttpClient;
  logger?: ProviderLogger;
  timeoutMs?: number;
};

const requireEvolutionConfig = (
  value: string | undefined,
  variableName: string,
) => {
  if (!value?.trim()) {
    throw new AppError(
      `${variableName} e obrigatoria para o provider evolution`,
      'EVOLUTION_CONFIG_REQUIRED',
    );
  }
  return value;
};

export const createWhatsAppProvider = (
  config: WhatsAppProviderFactoryConfig,
  options: WhatsAppProviderFactoryOptions = {},
): WhatsAppProvider => {
  if ((config.WHATSAPP_PROVIDER ?? 'mock') === 'mock') {
    return new MockWhatsAppProvider();
  }

  return new EvolutionApiWhatsAppProvider({
    baseUrl: requireEvolutionConfig(
      config.EVOLUTION_API_URL,
      'EVOLUTION_API_URL',
    ),
    apiKey: requireEvolutionConfig(
      config.EVOLUTION_API_KEY,
      'EVOLUTION_API_KEY',
    ),
    instanceName: requireEvolutionConfig(
      config.EVOLUTION_INSTANCE_NAME,
      'EVOLUTION_INSTANCE_NAME',
    ),
    ...options,
  });
};
