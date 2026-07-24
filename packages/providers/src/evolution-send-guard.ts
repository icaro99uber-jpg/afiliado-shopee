import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { ProviderLogger } from './evolution-api-whatsapp-provider';

export type EvolutionSendGuardOptions = {
  safeMode: boolean;
  allowedDestinations: readonly string[];
  maxMessagesPerBoot: number;
  logger?: ProviderLogger;
};

const DESTINATION_FORMATTING = /[\s()+.\-]/g;

export const normalizeEvolutionDestination = (destination: string) => {
  const normalized = destination.trim().replace(DESTINATION_FORMATTING, '');

  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new AppError(
      'Destino invalido para envio seguro pela Evolution API',
      'EVOLUTION_SAFE_DESTINATION_INVALID',
    );
  }

  return normalized;
};

export const maskEvolutionDestination = (destination: string) => {
  const visible = destination.slice(-4);
  return `${'*'.repeat(Math.max(4, destination.length - visible.length))}${visible}`;
};

export class EvolutionSendGuard {
  private readonly allowedDestinations: ReadonlySet<string>;
  private initiatedRequests = 0;

  constructor(private readonly options: EvolutionSendGuardOptions) {
    if (
      !Number.isInteger(options.maxMessagesPerBoot) ||
      options.maxMessagesPerBoot <= 0
    ) {
      throw new AppError(
        'Limite de mensagens da Evolution API deve ser um inteiro positivo',
        'EVOLUTION_SAFE_LIMIT_INVALID',
      );
    }

    this.allowedDestinations = new Set(
      options.safeMode
        ? options.allowedDestinations.map((destination) =>
            normalizeEvolutionDestination(destination),
          )
        : [],
    );

    options.logger?.info(
      {
        event: 'evolution.safe-mode.configured',
        safeMode: options.safeMode,
        maxMessagesPerBoot: options.maxMessagesPerBoot,
        allowedDestinationCount: this.allowedDestinations.size,
      },
      'Evolution API safe mode configured',
    );
  }

  get requestCount() {
    return this.initiatedRequests;
  }

  authorizeRequest(destination: string) {
    if (!this.options.safeMode) return;

    const normalized = normalizeEvolutionDestination(destination);
    if (!this.allowedDestinations.has(normalized)) {
      this.block(
        'EVOLUTION_SAFE_DESTINATION_BLOCKED',
        'Destino nao autorizado para o teste seguro da Evolution API',
        normalized,
      );
    }

    if (this.initiatedRequests >= this.options.maxMessagesPerBoot) {
      this.block(
        'EVOLUTION_SAFE_LIMIT_REACHED',
        'Limite de envios seguros da Evolution API atingido neste processo',
        normalized,
      );
    }

    this.initiatedRequests += 1;
    this.options.logger?.info(
      {
        event: 'evolution.safe-mode.request-authorized',
        safeMode: true,
        destination: maskEvolutionDestination(normalized),
        currentCount: this.initiatedRequests,
        maxMessagesPerBoot: this.options.maxMessagesPerBoot,
      },
      'Evolution API request authorized by safe mode',
    );
  }

  private block(code: string, message: string, destination: string): never {
    this.options.logger?.error(
      {
        event: 'evolution.safe-mode.blocked',
        safeMode: true,
        code,
        destination: maskEvolutionDestination(destination),
        currentCount: this.initiatedRequests,
        maxMessagesPerBoot: this.options.maxMessagesPerBoot,
      },
      'Evolution API request blocked by safe mode',
    );
    throw new AppError(message, code);
  }
}
