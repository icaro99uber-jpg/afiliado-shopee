import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppGroupSummary } from '@shopee-auto-affiliate-ai/providers';

import { GroupDirectoryService } from '../src/group-directory-service';
import type {
  WhatsAppGroupCreateData,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupFilters,
  WhatsAppGroupRecord,
  WhatsAppGroupUpdate,
} from '../src/repositories';

const GROUP_ID = '100000000000000000@g.us';
const INSTANCE = 'test-instance';
const NOW = new Date('2026-07-24T12:00:00.000Z');

class MemoryGroups implements WhatsAppGroupDirectoryRepository {
  records: WhatsAppGroupRecord[] = [];

  findById(id: string) {
    return Promise.resolve(
      this.records.find((group) => group.id === id) ?? null,
    );
  }

  findByExternalGroupId(sourceInstanceName: string, externalGroupId: string) {
    return Promise.resolve(
      this.records.find(
        (group) =>
          group.sourceInstanceName === sourceInstanceName &&
          group.destination === externalGroupId,
      ) ?? null,
    );
  }

  listByInstance(sourceInstanceName: string) {
    return Promise.resolve(
      this.records.filter(
        (group) => group.sourceInstanceName === sourceInstanceName,
      ),
    );
  }

  list(sourceInstanceName: string, filters: WhatsAppGroupFilters = {}) {
    return Promise.resolve(
      this.records.filter(
        (group) =>
          group.sourceInstanceName === sourceInstanceName &&
          (filters.active === undefined || group.active === filters.active) &&
          (filters.available === undefined ||
            group.available === filters.available),
      ),
    );
  }

  create(data: WhatsAppGroupCreateData) {
    const record = {
      ...data,
      id: `group-${this.records.length + 1}`,
      createdAt: NOW,
      updatedAt: NOW,
    } satisfies WhatsAppGroupRecord;
    this.records.push(record);
    return Promise.resolve(record);
  }

  update(id: string, data: WhatsAppGroupUpdate) {
    const index = this.records.findIndex((group) => group.id === id);
    if (index < 0) return Promise.resolve(null);
    this.records[index] = {
      ...this.records[index],
      ...data,
      updatedAt: NOW,
    };
    return Promise.resolve(this.records[index]);
  }
}

const createHarness = (initial: WhatsAppGroupSummary[] = []) => {
  let summaries = initial;
  const groups = new MemoryGroups();
  const provider = { listGroups: vi.fn(() => Promise.resolve(summaries)) };
  const logger = { info: vi.fn(), error: vi.fn() };
  const service = new GroupDirectoryService({
    provider,
    groups,
    instanceName: INSTANCE,
    logger,
    now: () => NOW,
  });
  return {
    service,
    groups,
    provider,
    setSummaries(value: WhatsAppGroupSummary[]) {
      summaries = value;
    },
  };
};

describe('GroupDirectoryService', () => {
  it('cria grupos descobertos inativos e retorna relatorio sem identificadores', async () => {
    const harness = createHarness([
      { externalGroupId: GROUP_ID, name: 'Grupo controlado', memberCount: 4 },
    ]);
    const report = await harness.service.sync();

    expect(report).toEqual({
      discovered: 1,
      created: 1,
      updated: 0,
      unavailable: 0,
      active: 0,
    });
    expect(JSON.stringify(report)).not.toContain(GROUP_ID);
    expect(harness.groups.records[0]).toMatchObject({
      type: 'GROUP',
      active: false,
      available: true,
      destination: GROUP_ID,
      sourceInstanceName: INSTANCE,
    });
  });

  it('atualiza metadados seguros e preserva autorizacao de grupo disponivel', async () => {
    const harness = createHarness([
      { externalGroupId: GROUP_ID, name: 'Nome inicial', memberCount: 2 },
    ]);
    await harness.service.sync();
    await harness.service.setActive('group-1', true, 'AUTORIZAR_GRUPO');
    harness.setSummaries([
      { externalGroupId: GROUP_ID, name: 'Nome atualizado', memberCount: 3 },
    ]);

    expect(await harness.service.sync()).toMatchObject({
      updated: 1,
      active: 1,
    });
    expect(harness.groups.records[0]).toMatchObject({
      name: 'Nome atualizado',
      memberCount: 3,
      active: true,
      available: true,
    });
  });

  it('preserva grupo ausente, marca indisponivel e desativa', async () => {
    const harness = createHarness([
      { externalGroupId: GROUP_ID, name: 'Grupo controlado' },
    ]);
    await harness.service.sync();
    await harness.service.setActive('group-1', true, 'AUTORIZAR_GRUPO');
    harness.setSummaries([]);

    expect(await harness.service.sync()).toMatchObject({
      unavailable: 1,
      active: 0,
    });
    expect(harness.groups.records).toHaveLength(1);
    expect(harness.groups.records[0]).toMatchObject({
      active: false,
      available: false,
    });
  });

  it('expoe somente fingerprint e metadados publicos', async () => {
    const harness = createHarness([
      { externalGroupId: GROUP_ID, name: 'Grupo controlado', memberCount: 2 },
    ]);
    await harness.service.sync();
    const [group] = await harness.service.list();
    const serialized = JSON.stringify(group);

    expect(group.fingerprint).toMatch(/^grp_[a-f0-9]{12}$/);
    expect(group).not.toHaveProperty('destination');
    expect(group).not.toHaveProperty('externalGroupId');
    expect(group).not.toHaveProperty('participants');
    expect(serialized).not.toContain(GROUP_ID);
  });

  it('exige confirmacao para ativar, permite desativar direta e bloqueia indisponivel', async () => {
    const harness = createHarness([
      { externalGroupId: GROUP_ID, name: 'Grupo controlado' },
    ]);
    await harness.service.sync();
    await expect(
      harness.service.setActive('group-1', true),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_CONFIRMATION_REQUIRED',
    });
    await expect(
      harness.service.setActive('group-1', true, 'AUTORIZAR_GRUPO'),
    ).resolves.toMatchObject({ active: true });
    await expect(
      harness.service.setActive('group-1', false),
    ).resolves.toMatchObject({
      active: false,
    });
    harness.groups.records[0].available = false;
    await expect(
      harness.service.setActive('group-1', true, 'AUTORIZAR_GRUPO'),
    ).rejects.toMatchObject({ code: 'WHATSAPP_GROUP_UNAVAILABLE' });
  });

  it('rejeita resposta duplicada sem criar parcialmente', async () => {
    const harness = createHarness([
      { externalGroupId: GROUP_ID, name: 'A' },
      { externalGroupId: GROUP_ID, name: 'B' },
    ]);
    await expect(harness.service.sync()).rejects.toMatchObject({
      code: 'WHATSAPP_GROUP_DIRECTORY_AMBIGUOUS',
    });
    expect(harness.groups.records).toHaveLength(0);
  });
});
