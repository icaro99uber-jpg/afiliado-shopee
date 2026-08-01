import { describe, expect, it, vi } from 'vitest';

import {
  executeCommercialCopyAttemptStatusCli,
  parseCommercialCopyAttemptStatusCliArgs,
} from '../src/commercial-copy-attempt-status-cli';
import type { CommercialCopyGenerationAttemptRecord } from '../src/repositories';

const attempt = (
  overrides: Partial<CommercialCopyGenerationAttemptRecord> = {},
): CommercialCopyGenerationAttemptRecord => ({
  id: 'attempt-1',
  candidateId: 'candidate-1',
  snapshotId: 'snapshot-internal',
  inputFingerprint: 'private-fingerprint',
  provider: 'OpenAI',
  model: 'GPT-5-MINI',
  promptVersion: 'commercial-promotion-copy-v1',
  validationVersion: 'commercial-promotion-copy-validation-v2',
  status: 'FAILED',
  generatedCopyId: null,
  failureCode: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
  requestMayHaveStarted: false,
  providerHttpStatus: 429,
  providerErrorCode: 'insufficient_quota',
  providerErrorType: 'insufficient_quota',
  providerErrorParam: 'model',
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  startedAt: new Date('2026-08-01T12:00:00.000Z'),
  completedAt: new Date('2026-08-01T12:00:01.000Z'),
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  updatedAt: new Date('2026-08-01T12:00:01.000Z'),
  ...overrides,
});

describe('commercial copy attempt status CLI', () => {
  it('aceita somente candidate-id direto ou depois de um separador', () => {
    expect(
      parseCommercialCopyAttemptStatusCliArgs(['--candidate-id=candidate-1']),
    ).toEqual({
      candidateId: 'candidate-1',
    });
    expect(
      parseCommercialCopyAttemptStatusCliArgs([
        '--',
        '--candidate-id=candidate-1',
      ]),
    ).toEqual({ candidateId: 'candidate-1' });
  });

  it.each([
    { args: [] },
    { args: ['--candidate-id=one', '--candidate-id=two'] },
    { args: ['--unknown=value'] },
    { args: ['candidate-1'] },
    { args: ['--candidate-id=https://example.invalid/private'] },
  ])('rejeita argumentos inválidos', ({ args }) => {
    try {
      parseCommercialCopyAttemptStatusCliArgs(args);
      throw new Error('expected parser to reject');
    } catch (error) {
      expect(error).toMatchObject({
        code: expect.stringMatching(/^COMMERCIAL_AI_COPY_ATTEMPT/u),
      });
    }
  });

  it('consulta apenas tentativas do candidato e retorna diagnóstico sanitizado', async () => {
    const listAttemptsByCandidateId = vi.fn().mockResolvedValue([
      attempt(),
      attempt({
        id: 'attempt-2',
        status: 'AMBIGUOUS',
        failureCode: null,
        requestMayHaveStarted: true,
        providerHttpStatus: 700,
        providerErrorCode: 'contains secret',
        providerErrorType: 'network_error',
        providerErrorParam: 'body[0]',
        completedAt: null,
      }),
    ]);

    const result = await executeCommercialCopyAttemptStatusCli({
      args: ['--candidate-id=candidate-1'],
      repository: { listAttemptsByCandidateId },
    });

    expect(listAttemptsByCandidateId).toHaveBeenCalledWith('candidate-1');
    expect(result).toEqual([
      {
        attemptId: 'attempt-1',
        candidateId: 'candidate-1',
        status: 'FAILED',
        failureCode: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
        requestMayHaveStarted: false,
        provider: 'openai',
        model: 'gpt-5-mini',
        promptVersion: 'commercial-promotion-copy-v1',
        validationVersion: 'commercial-promotion-copy-validation-v2',
        providerHttpStatus: 429,
        providerErrorCode: 'insufficient_quota',
        providerErrorType: 'insufficient_quota',
        providerErrorParam: 'model',
        startedAt: '2026-08-01T12:00:00.000Z',
        completedAt: '2026-08-01T12:00:01.000Z',
      },
      {
        attemptId: 'attempt-2',
        candidateId: 'candidate-1',
        status: 'AMBIGUOUS',
        failureCode: null,
        requestMayHaveStarted: true,
        provider: 'openai',
        model: 'gpt-5-mini',
        promptVersion: 'commercial-promotion-copy-v1',
        validationVersion: 'commercial-promotion-copy-validation-v2',
        providerHttpStatus: null,
        providerErrorCode: null,
        providerErrorType: 'network_error',
        providerErrorParam: 'body[0]',
        startedAt: '2026-08-01T12:00:00.000Z',
        completedAt: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('private-fingerprint');
    expect(JSON.stringify(result)).not.toContain('contains secret');
    expect(JSON.stringify(result)).not.toContain('snapshot-internal');
  });

  it('retorna lista vazia sem escrita', async () => {
    const listAttemptsByCandidateId = vi.fn().mockResolvedValue([]);
    await expect(
      executeCommercialCopyAttemptStatusCli({
        args: ['--candidate-id=candidate-empty'],
        repository: { listAttemptsByCandidateId },
      }),
    ).resolves.toEqual([]);
    expect(listAttemptsByCandidateId).toHaveBeenCalledTimes(1);
  });
});
