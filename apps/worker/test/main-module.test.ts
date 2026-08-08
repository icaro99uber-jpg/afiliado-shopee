import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isMainModule } from '../src/main-module';

const entryPath = 'src/main-module.ts';
const entryUrl = pathToFileURL(resolve(entryPath)).href;

describe('isMainModule', () => {
  it('retorna true quando argvEntry corresponde ao importMetaUrl', () => {
    expect(isMainModule(entryUrl, entryPath)).toBe(true);
  });

  it('retorna false para outro arquivo', () => {
    expect(isMainModule(entryUrl, 'src/index.ts')).toBe(false);
  });

  it('retorna false quando argvEntry e undefined', () => {
    const originalArgv = [...process.argv];

    try {
      process.argv.splice(1);
      expect(isMainModule(entryUrl)).toBe(false);
    } finally {
      process.argv.splice(0, process.argv.length, ...originalArgv);
    }
  });

  it('retorna false quando argvEntry e vazio', () => {
    expect(isMainModule(entryUrl, '')).toBe(false);
  });

  it('resolve corretamente um caminho relativo', () => {
    expect(
      isMainModule(
        pathToFileURL(resolve(entryPath)).href,
        './src/../src/main-module.ts',
      ),
    ).toBe(true);
  });
});
