import type {
  WhatsAppGroupDirectoryProvider,
  WhatsAppGroupSummary,
} from '@shopee-auto-affiliate-ai/providers';
import {
  fingerprintWhatsAppGroupId,
  normalizeWhatsAppGroupId,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type {
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupFilters,
  WhatsAppGroupRecord,
} from './repositories';

export type WhatsAppGroupPublic = {
  id: string;
  name: string;
  fingerprint: string;
  memberCount: number | null;
  ownerIsParticipant: boolean | null;
  active: boolean;
  available: boolean;
  discoveredAt: string;
  lastSyncedAt: string;
  updatedAt: string | null;
};

export type GroupDirectorySyncReport = {
  discovered: number;
  created: number;
  updated: number;
  unavailable: number;
  active: number;
};

type GroupDirectoryLogger = {
  info(data: Record<string, unknown>, message?: string): void;
  error(data: Record<string, unknown>, message?: string): void;
};

type GroupDirectoryServiceOptions = {
  provider: WhatsAppGroupDirectoryProvider;
  groups: WhatsAppGroupDirectoryRepository;
  instanceName: string;
  logger: GroupDirectoryLogger;
  now?: () => Date;
};

export const toWhatsAppGroupPublic = (
  group: WhatsAppGroupRecord,
): WhatsAppGroupPublic => ({
  id: group.id,
  name: group.name,
  fingerprint: group.fingerprint,
  memberCount: group.memberCount ?? null,
  ownerIsParticipant: group.ownerIsParticipant ?? null,
  active: group.active,
  available: group.available,
  discoveredAt: group.discoveredAt.toISOString(),
  lastSyncedAt: group.lastSyncedAt.toISOString(),
  updatedAt: group.updatedAt?.toISOString() ?? null,
});

const normalizeSummary = (summary: WhatsAppGroupSummary) => ({
  externalGroupId: normalizeWhatsAppGroupId(summary.externalGroupId),
  name: summary.name.trim(),
  memberCount: summary.memberCount ?? null,
  ownerIsParticipant: summary.ownerIsParticipant ?? null,
});

export class GroupDirectoryService {
  constructor(private readonly options: GroupDirectoryServiceOptions) {
    if (!options.instanceName.trim()) {
      throw new AppError(
        'Instancia do diretorio de grupos e obrigatoria',
        'WHATSAPP_GROUP_INSTANCE_REQUIRED',
      );
    }
  }

  async sync(): Promise<GroupDirectorySyncReport> {
    const syncedAt = (this.options.now ?? (() => new Date()))();
    try {
      const discovered = (await this.options.provider.listGroups()).map(
        normalizeSummary,
      );
      const ids = new Set<string>();
      for (const group of discovered) {
        if (!group.name || ids.has(group.externalGroupId)) {
          throw new AppError(
            'Diretorio de grupos retornou dados ambiguos',
            'WHATSAPP_GROUP_DIRECTORY_AMBIGUOUS',
          );
        }
        ids.add(group.externalGroupId);
      }

      const previous = await this.options.groups.listByInstance(
        this.options.instanceName,
      );
      const byExternalId = new Map(
        previous.map((group) => [group.destination, group]),
      );
      let created = 0;
      let updated = 0;
      let unavailable = 0;
      const current: WhatsAppGroupRecord[] = [];

      for (const group of discovered) {
        const fingerprint = fingerprintWhatsAppGroupId(group.externalGroupId);
        const existing = byExternalId.get(group.externalGroupId);
        if (!existing) {
          current.push(
            await this.options.groups.create({
              name: group.name,
              destination: group.externalGroupId,
              type: 'GROUP',
              active: false,
              available: true,
              fingerprint,
              sourceInstanceName: this.options.instanceName,
              memberCount: group.memberCount,
              ownerIsParticipant: group.ownerIsParticipant,
              discoveredAt: syncedAt,
              lastSyncedAt: syncedAt,
            }),
          );
          created += 1;
          continue;
        }

        const refreshed = await this.options.groups.update(existing.id, {
          name: group.name,
          available: true,
          fingerprint,
          memberCount: group.memberCount,
          ownerIsParticipant: group.ownerIsParticipant,
          lastSyncedAt: syncedAt,
        });
        if (!refreshed) {
          throw new AppError(
            'Grupo desapareceu durante a sincronizacao',
            'WHATSAPP_GROUP_SYNC_CONFLICT',
          );
        }
        current.push(refreshed);
        updated += 1;
      }

      for (const existing of previous) {
        if (ids.has(existing.destination)) continue;
        await this.options.groups.update(existing.id, {
          active: false,
          available: false,
          lastSyncedAt: syncedAt,
        });
        unavailable += 1;
      }

      const report = {
        discovered: discovered.length,
        created,
        updated,
        unavailable,
        active: current.filter((group) => group.active && group.available)
          .length,
      };
      this.options.logger.info(
        { event: 'whatsapp.groups.synced', ...report },
        'WhatsApp groups synced',
      );
      return report;
    } catch (error) {
      this.options.logger.error(
        {
          event: 'whatsapp.groups.sync-failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
          code: error instanceof AppError ? error.code : 'UNKNOWN',
        },
        'WhatsApp group sync failed',
      );
      throw error;
    }
  }

  async list(filters: WhatsAppGroupFilters = {}) {
    return (
      await this.options.groups.list(this.options.instanceName, filters)
    ).map(toWhatsAppGroupPublic);
  }

  async find(id: string) {
    const group = await this.options.groups.findById(id);
    if (!group || group.sourceInstanceName !== this.options.instanceName) {
      throw new AppError('Grupo nao encontrado', 'WHATSAPP_GROUP_NOT_FOUND');
    }
    return toWhatsAppGroupPublic(group);
  }

  async setActive(id: string, active: boolean, confirm?: string) {
    const group = await this.options.groups.findById(id);
    if (!group || group.sourceInstanceName !== this.options.instanceName) {
      throw new AppError('Grupo nao encontrado', 'WHATSAPP_GROUP_NOT_FOUND');
    }
    if (active && confirm !== 'AUTORIZAR_GRUPO') {
      throw new AppError(
        'Confirmacao explicita e obrigatoria para autorizar o grupo',
        'WHATSAPP_GROUP_CONFIRMATION_REQUIRED',
      );
    }
    if (active && !group.available) {
      throw new AppError(
        'Grupo indisponivel nao pode ser autorizado',
        'WHATSAPP_GROUP_UNAVAILABLE',
      );
    }
    const updated = await this.options.groups.update(group.id, { active });
    if (!updated) {
      throw new AppError('Grupo nao encontrado', 'WHATSAPP_GROUP_NOT_FOUND');
    }
    return toWhatsAppGroupPublic(updated);
  }
}
