import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { ProviderLogger } from './evolution-api-whatsapp-provider';
import {
  fingerprintWhatsAppGroupId,
  normalizeWhatsAppGroupId,
} from './whatsapp-group-directory';

export type EvolutionGroupSendGuardOptions = {
  enabled: boolean;
  safeMode: boolean;
  maxMessagesPerRun: number;
  logger?: ProviderLogger;
};

export class EvolutionGroupSendGuard {
  private initiatedRequests = 0;

  constructor(private readonly options: EvolutionGroupSendGuardOptions) {
    if (
      !Number.isInteger(options.maxMessagesPerRun) ||
      options.maxMessagesPerRun <= 0
    ) {
      throw new AppError(
        'Limite de mensagens para grupos deve ser um inteiro positivo',
        'WHATSAPP_GROUP_LIMIT_INVALID',
      );
    }
    options.logger?.info(
      {
        event: 'evolution.group-safe-mode.configured',
        enabled: options.enabled,
        safeMode: options.safeMode,
        maxMessagesPerRun: options.maxMessagesPerRun,
      },
      'Evolution group safe mode configured',
    );
  }

  get requestCount() {
    return this.initiatedRequests;
  }

  authorizeRequest(externalGroupId: string) {
    const normalized = normalizeWhatsAppGroupId(externalGroupId);
    const fingerprint = fingerprintWhatsAppGroupId(normalized);
    if (!this.options.enabled) {
      return this.block(
        'WHATSAPP_GROUP_SEND_DISABLED',
        'Envio para grupos esta desativado',
        fingerprint,
      );
    }
    if (!this.options.safeMode) {
      return this.block(
        'WHATSAPP_GROUP_SAFE_MODE_REQUIRED',
        'Safe mode e obrigatorio para envio em grupos',
        fingerprint,
      );
    }
    if (this.initiatedRequests >= this.options.maxMessagesPerRun) {
      return this.block(
        'WHATSAPP_GROUP_LIMIT_REACHED',
        'Limite de mensagens para grupos atingido neste processo',
        fingerprint,
      );
    }

    this.initiatedRequests += 1;
    this.options.logger?.info(
      {
        event: 'evolution.group-safe-mode.request-authorized',
        fingerprint,
        currentCount: this.initiatedRequests,
        maxMessagesPerRun: this.options.maxMessagesPerRun,
      },
      'Evolution group request authorized',
    );
  }

  private block(code: string, message: string, fingerprint: string): never {
    this.options.logger?.error(
      {
        event: 'evolution.group-safe-mode.blocked',
        code,
        fingerprint,
        currentCount: this.initiatedRequests,
        maxMessagesPerRun: this.options.maxMessagesPerRun,
      },
      'Evolution group request blocked',
    );
    throw new AppError(message, code);
  }
}
