import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  executeCommercialDryRun,
  parseCommercialDryRunArgs,
  runCommercialDryRunMain,
} from '../src/commercial-pipeline-cli';

const safeResult = {
  runId: 'run-safe',
  mode: 'dry-run' as const,
  status: 'ready' as const,
  provider: 'mock' as const,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectedProduct: {
    id: 'product-safe',
    name: 'Produto ficticio',
    price: '10.00',
    score: 80,
    affiliateLinkPresent: true as const,
  },
  selectedGroup: {
    id: 'group-safe',
    name: 'Grupo ficticio',
    fingerprint: 'grp_123456789abc',
  },
  selectionReasons: ['Maior score elegivel: 80'],
  copyPreview: 'Oferta\nhttps://example.invalid/affiliate',
  plannedSubIds: ['whatsapp'],
  dispatchWillBeCreated: false as const,
  jobWillBeCreated: false as const,
  messageWillBeSent: false as const,
};

afterEach(() => vi.restoreAllMocks());

describe('commercial:dry-run CLI', () => {
  it('aceita dry-run padrao', () => {
    expect(parseCommercialDryRunArgs([])).toEqual({});
  });

  it('aceita source mock', () => {
    expect(parseCommercialDryRunArgs(['--source=mock'])).toEqual({
      source: 'MOCK',
    });
  });

  it('aceita source manual', () => {
    expect(parseCommercialDryRunArgs(['--source=manual'])).toEqual({
      source: 'MANUAL',
    });
  });

  it('aceita source official persistida', () => {
    expect(parseCommercialDryRunArgs(['--source=official'])).toEqual({
      source: 'OFFICIAL',
    });
  });

  it('bloqueia provider official sem source persistida explicita', async () => {
    const service = { dryRun: vi.fn() };
    await expect(
      executeCommercialDryRun({
        input: {},
        provider: 'official',
        schedulerEnabled: false,
        commercialSchedulerEnabled: false,
        groupSendEnabled: false,
        service: service as never,
      }),
    ).rejects.toMatchObject({
      code: 'SHOPEE_OFFICIAL_PERSISTED_SOURCE_REQUIRED',
    });
    expect(service.dryRun).not.toHaveBeenCalled();
  });

  it.each(['--send', '--confirm', '--group=x', '--coupon=x', '--message=x'])(
    'bloqueia a flag %s',
    (flag) => {
      expect(() => parseCommercialDryRunArgs([flag])).toThrowError(
        expect.objectContaining({ code: 'INVALID_COMMERCIAL_DRY_RUN_FLAG' }),
      );
    },
  );

  it('executa mock local e retorna somente resultado dry-run', async () => {
    const syncMock = vi.fn().mockResolvedValue(undefined);
    const service = { dryRun: vi.fn().mockResolvedValue(safeResult) };
    const result = await executeCommercialDryRun({
      input: { source: 'MOCK' },
      provider: 'mock',
      schedulerEnabled: false,
      commercialSchedulerEnabled: false,
      groupSendEnabled: false,
      service,
      syncMock,
    });
    expect(result).toEqual(safeResult);
    expect(syncMock).toHaveBeenCalledOnce();
    expect(result.messageWillBeSent).toBe(false);
  });

  it('nao sincroniza provider manual', async () => {
    const syncMock = vi.fn();
    const service = { dryRun: vi.fn().mockResolvedValue(safeResult) };
    await executeCommercialDryRun({
      input: { source: 'MANUAL' },
      provider: 'manual',
      schedulerEnabled: false,
      commercialSchedulerEnabled: false,
      groupSendEnabled: false,
      service,
      syncMock,
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('usa catalogo official persistido sem sincronizar a Shopee', async () => {
    const syncMock = vi.fn();
    const service = { dryRun: vi.fn().mockResolvedValue(safeResult) };
    await executeCommercialDryRun({
      input: { source: 'OFFICIAL' },
      provider: 'official',
      schedulerEnabled: false,
      commercialSchedulerEnabled: false,
      groupSendEnabled: false,
      service,
      syncMock,
    });
    expect(service.dryRun).toHaveBeenCalledWith({ source: 'OFFICIAL' });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('nao sincroniza mock quando a source efetiva e OFFICIAL', async () => {
    const syncMock = vi.fn();
    const service = { dryRun: vi.fn().mockResolvedValue(safeResult) };
    await executeCommercialDryRun({
      input: { source: 'OFFICIAL' },
      provider: 'mock',
      schedulerEnabled: false,
      commercialSchedulerEnabled: false,
      groupSendEnabled: false,
      service,
      syncMock,
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('retorna exit code 0 no sucesso', async () => {
    expect(
      await runCommercialDryRunMain([], vi.fn().mockResolvedValue(safeResult)),
    ).toBe(0);
  });

  it('retorna exit code 1 com saida sanitizada no bloqueio', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const code = await runCommercialDryRunMain(
      [],
      vi
        .fn()
        .mockRejectedValue(
          new AppError('Grupo indisponivel', 'NO_AUTHORIZED_GROUP'),
        ),
    );
    expect(code).toBe(1);
    const output = error.mock.calls.flat().join(' ');
    expect(output).toContain('NO_AUTHORIZED_GROUP');
    expect(output).not.toContain('@g.us');
    expect(output).not.toContain('apikey');
  });

  it('bloqueia ambiente com Scheduler ou group send ativos', async () => {
    await expect(
      executeCommercialDryRun({
        input: {},
        provider: 'mock',
        schedulerEnabled: true,
        commercialSchedulerEnabled: false,
        groupSendEnabled: false,
        service: { dryRun: vi.fn() } as never,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_DRY_RUN_UNSAFE_ENVIRONMENT' });

    await expect(
      executeCommercialDryRun({
        input: {},
        provider: 'mock',
        schedulerEnabled: false,
        commercialSchedulerEnabled: true,
        groupSendEnabled: false,
        service: { dryRun: vi.fn() } as never,
      }),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_DRY_RUN_UNSAFE_ENVIRONMENT' });
  });
});
