import { createHash } from 'node:crypto';

import { AppError } from '@shopee-auto-affiliate-ai/shared';

export type WhatsAppGroupSummary = {
  externalGroupId: string;
  name: string;
  memberCount?: number;
  ownerIsParticipant?: boolean;
};

export interface WhatsAppGroupDirectoryProvider {
  listGroups(): Promise<WhatsAppGroupSummary[]>;
}

const GROUP_ID_PATTERN = /^\d+(?:-\d+)*@g\.us$/;

/**
 * Group IDs are opaque Evolution/Baileys identifiers. Unlike phone numbers,
 * they must never have punctuation removed or receive a suffix implicitly.
 */
export const normalizeWhatsAppGroupId = (value: string) => {
  const normalized = value.trim();
  if (!normalized || !GROUP_ID_PATTERN.test(normalized)) {
    throw new AppError(
      'Identificador de grupo WhatsApp invalido',
      'WHATSAPP_GROUP_ID_INVALID',
    );
  }
  return normalized;
};

export const isWhatsAppGroupId = (value: string) => {
  try {
    normalizeWhatsAppGroupId(value);
    return true;
  } catch {
    return false;
  }
};

export const fingerprintWhatsAppGroupId = (value: string) => {
  const normalized = normalizeWhatsAppGroupId(value);
  return `grp_${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`;
};
