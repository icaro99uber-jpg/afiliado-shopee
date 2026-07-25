import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runShopeeImport } from '../src/shopee-import';

describe('shopee:import', () => {
  it('usa dry-run por padrao e nao inicializa escrita', async () => {
    const fixture = fileURLToPath(
      new URL(
        '../../../fixtures/shopee-manual-offer.example.json',
        import.meta.url,
      ),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runShopeeImport(['--file', fixture])).resolves.toEqual({
      mode: 'dry-run',
      validRecords: 1,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"recordsWritten":0'),
    );
    log.mockRestore();
  });
});
