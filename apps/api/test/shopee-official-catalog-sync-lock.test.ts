import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PostgresShopeeOfficialCatalogSyncLock } from '../src/shopee-official-catalog-sync-lock';
import type { LockClient } from '../src/shopee-official-catalog-sync-lock';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { Mock } from 'vitest';

describe('PostgresShopeeOfficialCatalogSyncLock', () => {
  let mockClient: Record<string, Mock>;
  let createClient: (connectionString: string) => LockClient;
  const dbUrl = 'postgresql://localhost:5432/app';

  beforeEach(() => {
    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    createClient = vi.fn().mockReturnValue(mockClient) as unknown as (connectionString: string) => LockClient;
  });

  it('adquire lock, executa a operacao apenas uma vez, faz unlock e encerra o client', async () => {
    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });
    mockClient.query.mockResolvedValueOnce({}); // unlock

    const operation = vi.fn().mockResolvedValue('success');
    const result = await lock.runExclusive(operation);

    expect(result).toBe('success');
    expect(mockClient.connect).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(mockClient.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(mockClient.end).toHaveBeenCalledOnce();
  });

  it('lanca erro e nao executa a operacao quando lock recusado', async () => {
    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    const operation = vi.fn();
    await expect(lock.runExclusive(operation)).rejects.toThrowError(
      new AppError('Sincronizacao operacional ja esta em andamento', 'SHOPEE_OFFICIAL_CATALOG_SYNC_IN_PROGRESS')
    );

    expect(operation).not.toHaveBeenCalled();
    expect(mockClient.end).toHaveBeenCalledOnce();
  });

  it('encerra client mesmo apos falha da operacao', async () => {
    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });

    const operation = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(lock.runExclusive(operation)).rejects.toThrowError('boom');

    expect(operation).toHaveBeenCalledOnce();
    expect(mockClient.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(mockClient.end).toHaveBeenCalledOnce();
  });

  it('lanca erro se falhar ao conectar', async () => {
    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.connect.mockRejectedValue(new Error('no connection'));

    const operation = vi.fn();
    await expect(lock.runExclusive(operation)).rejects.toThrowError(
      new AppError('Falha ao conectar no banco para lock', 'SHOPEE_OFFICIAL_CATALOG_SYNC_UNKNOWN_ERROR')
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('erro de unlock nao mascara erro da operacao', async () => {
    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });

    // Configura erro no unlock
    mockClient.query.mockImplementation(async (queryStr: string) => {
      if (queryStr.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      throw new Error('unlock error');
    });

    const operation = vi.fn().mockRejectedValue(new Error('original error'));

    await expect(lock.runExclusive(operation)).rejects.toThrowError('original error');
    expect(mockClient.end).toHaveBeenCalledOnce();
  });

  it('erro de end nao mascara erro da operacao', async () => {
    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.query.mockResolvedValueOnce({ rows: [{ acquired: true }] });
    mockClient.end.mockRejectedValue(new Error('end error'));

    const operation = vi.fn().mockRejectedValue(new Error('original error'));

    await expect(lock.runExclusive(operation)).rejects.toThrowError('original error');
  });

  it('nunca loga a DATABASE_URL', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const errSpy = vi.spyOn(console, 'error');

    const lock = new PostgresShopeeOfficialCatalogSyncLock(dbUrl, createClient);
    mockClient.connect.mockRejectedValue(new Error('failed with url ' + dbUrl));

    await expect(lock.runExclusive(vi.fn())).rejects.toThrowError();

    const logs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join(' ');
    expect(logs).not.toContain(dbUrl);

    logSpy.mockRestore();
    errSpy.mockRestore();
  });
});
