import { describe, expect, it, vi } from 'vitest';

import {
  assertCommercialPromotionMineEnvironment,
  executeCommercialPromotionCli,
  parseCommercialPromotionCliArgs,
} from '../src/commercial-promotion-mining-cli';

const safeEnvironment = () => ({
  ci: false,
  databaseUrl: 'postgresql://local@127.0.0.1:5432/test',
  automationMode: 'preview' as const,
  automationEnabled: false,
  automationPaused: true,
  schedulerEnabled: false,
  commercialSchedulerEnabled: false,
  groupSendEnabled: false,
  dispatchWorkers: 0,
});

describe('commercial promotion mining CLI', () => {
  it('aceita o separador do pnpm e somente campaign-id no preview', () => {
    expect(
      parseCommercialPromotionCliArgs('preview', [
        '--',
        '--campaign-id=campaign-1',
      ]),
    ).toEqual({ mode: 'preview', campaignId: 'campaign-1' });
  });

  it('aceita as flags do mine em qualquer ordem', () => {
    expect(
      parseCommercialPromotionCliArgs('mine', [
        '--campaign-id=campaign-1',
        '--confirm-local-promotion-mining',
      ]),
    ).toEqual({ mode: 'mine', campaignId: 'campaign-1' });
    expect(
      parseCommercialPromotionCliArgs('mine', [
        '--',
        '--confirm-local-promotion-mining',
        '--campaign-id=campaign-1',
      ]),
    ).toEqual({ mode: 'mine', campaignId: 'campaign-1' });
  });

  it.each([
    ['mine', ['--campaign-id=campaign-1']],
    [
      'mine',
      [
        '--campaign-id=campaign-1',
        '--campaign-id=campaign-2',
        '--confirm-local-promotion-mining',
      ],
    ],
    [
      'mine',
      [
        '--campaign-id=campaign-1',
        '--confirm-local-promotion-mining',
        '--extra',
      ],
    ],
    ['preview', ['campaign-1']],
    ['preview', ['--campaign-id=grp_fingerprint']],
    ['preview', ['--campaign-id=group@g.us']],
  ] as const)('rejeita argumentos invalidos em %s', (mode, args) => {
    expect(() => parseCommercialPromotionCliArgs(mode, args)).toThrow();
  });

  it('bloqueia CI, banco remoto e cada estado operacional inseguro', () => {
    const unsafe = [
      { ci: true },
      { databaseUrl: 'postgresql://remote@example.com:5432/prod' },
      { automationMode: 'send' as const },
      { automationEnabled: true },
      { automationPaused: false },
      { schedulerEnabled: true },
      { commercialSchedulerEnabled: true },
      { groupSendEnabled: true },
      { dispatchWorkers: 1 },
    ];
    for (const override of unsafe) {
      expect(() =>
        assertCommercialPromotionMineEnvironment({
          ...safeEnvironment(),
          ...override,
        }),
      ).toThrow();
    }
  });

  it('executa preview sem escrita e mine apenas depois do ambiente seguro', async () => {
    const preview = vi.fn(async () => ({ preview: true }));
    const mine = vi.fn(async () => ({ preview: false }));
    await expect(
      executeCommercialPromotionCli({
        mode: 'preview',
        args: ['--campaign-id=campaign-1'],
        service: { preview, mine } as never,
      }),
    ).resolves.toEqual({ preview: true });
    expect(mine).not.toHaveBeenCalled();

    await expect(
      executeCommercialPromotionCli({
        mode: 'mine',
        args: ['--confirm-local-promotion-mining', '--campaign-id=campaign-1'],
        service: { preview, mine } as never,
        environment: safeEnvironment(),
      }),
    ).resolves.toEqual({ preview: false });
    expect(mine).toHaveBeenCalledWith('campaign-1', {
      confirm: 'MINERAR_PROMOCOES',
    });
  });

  it('nao executa o servico quando o ambiente do mine e inseguro', async () => {
    const mine = vi.fn();
    await expect(
      executeCommercialPromotionCli({
        mode: 'mine',
        args: ['--campaign-id=campaign-1', '--confirm-local-promotion-mining'],
        service: { preview: vi.fn(), mine },
        environment: { ...safeEnvironment(), dispatchWorkers: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PROMOTION_DISPATCH_WORKER_ACTIVE',
    });
    expect(mine).not.toHaveBeenCalled();
  });
});
