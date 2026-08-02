import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { Client } from 'pg';

export interface ShopeeOfficialCatalogSyncLock {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}

export interface LockClient {
  connect(): Promise<void>;
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

export class PostgresShopeeOfficialCatalogSyncLock implements ShopeeOfficialCatalogSyncLock {
  private readonly lockId = 88812345n;

  constructor(
    private readonly databaseUrl: string,
    private readonly createClient?: (connectionString: string) => LockClient
  ) {}

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const client: LockClient = this.createClient
      ? this.createClient(this.databaseUrl)
      : new Client({ connectionString: this.databaseUrl }) as unknown as LockClient;
    try {
      await client.connect();
    } catch {
      throw new AppError('Falha ao conectar no banco para lock', 'SHOPEE_OFFICIAL_CATALOG_SYNC_UNKNOWN_ERROR');
    }

    try {
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [this.lockId.toString()]
      );

      if (!result.rows[0]?.acquired) {
        await client.end().catch(() => {});
        throw new AppError(
          'Sincronizacao operacional ja esta em andamento',
          'SHOPEE_OFFICIAL_CATALOG_SYNC_IN_PROGRESS',
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      await client.end().catch(() => {});
      throw new AppError('Erro ao adquirir lock', 'SHOPEE_OFFICIAL_CATALOG_SYNC_UNKNOWN_ERROR');
    }

    try {
      const result = await operation();
      return result;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [this.lockId.toString()]);
      } catch {
        // Ignora erro no cleanup para não mascarar erro principal
      }
      await client.end().catch(() => {});
    }
  }
}
