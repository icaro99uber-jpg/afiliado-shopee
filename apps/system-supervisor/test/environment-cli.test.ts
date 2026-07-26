import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDotEnv } from '@shopee-auto-affiliate-ai/config';

import { loadLocalSystemEnvironment } from '../src/environment';
import { parseSystemArgs } from '../src/cli';
import {
  acquireLock,
  readState,
  runtimeDirectory,
  statePath,
} from '../src/state-store';

const directories: string[] = [];
const temporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-system-env-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local system environment', () => {
  it('loads the ignored root env and lets process variables override it', () => {
    const root = temporaryDirectory();
    writeFileSync(
      join(root, '.env'),
      'COMMERCIAL_AUTOMATION_MODE=send\nPORT=3334\nSECRET_VALUE=file-only\n',
    );

    const loaded = loadLocalSystemEnvironment(root, {
      COMMERCIAL_AUTOMATION_MODE: 'preview',
      PORT: '4444',
    });

    expect(loaded.mode).toBe('preview');
    expect(loaded.ports.api).toBe(4444);
    expect(loaded.env.SECRET_VALUE).toBe('file-only');
  });

  it('parses quoted values and strips only unquoted comments', () => {
    expect(
      parseDotEnv('A="value # kept"\nB=value # ignored\nexport C=ok\n'),
    ).toEqual({ A: 'value # kept', B: 'value', C: 'ok' });
  });
});

describe('local system CLI arguments', () => {
  it('accepts only the documented status and log options', () => {
    expect(parseSystemArgs(['status', '--', '--json'])).toEqual({
      command: 'status',
      json: true,
    });
    expect(
      parseSystemArgs(['logs', '--', '--service=supervisor', '--lines=50']),
    ).toEqual({ command: 'logs', service: 'supervisor', lines: 50 });
  });

  it.each([
    ['logs', '--service=../../.env'],
    ['logs', '--lines=0'],
    ['logs', '--lines=1001'],
    ['logs', '--path=.env'],
    ['status', '--verbose'],
    ['start', '--send'],
  ])('rejects unsafe or undocumented arguments: %s', (...args) => {
    expect(() => parseSystemArgs(args)).toThrow();
  });
});

describe('local system operation lock', () => {
  it('rejects a concurrent operation and releases the lock', () => {
    const root = temporaryDirectory();
    const release = acquireLock(root);
    expect(() => acquireLock(root)).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_OPERATION_IN_PROGRESS' }),
    );
    release();
    expect(acquireLock(root)).toEqual(expect.any(Function));
  });

  it('recovers a stale lock without touching runtime state', () => {
    const root = temporaryDirectory();
    mkdirSync(runtimeDirectory(root), { recursive: true });
    writeFileSync(join(runtimeDirectory(root), 'lock'), '99999999');
    const release = acquireLock(root);
    release();
  });
});

describe('local system state validation', () => {
  it('rejects PIDs, paths and extra fields outside the sanitized schema', () => {
    const root = temporaryDirectory();
    mkdirSync(runtimeDirectory(root), { recursive: true });
    writeFileSync(
      statePath(root),
      JSON.stringify({
        version: 1,
        startedAt: '2026-07-25T12:00:00.000Z',
        mode: 'preview',
        ports: {
          api: 3333,
          dashboard: 3000,
          postgres: 5432,
          redis: 6379,
          evolution: 8080,
        },
        processes: {
          api: {
            pid: '1; Stop-Process -Name node',
            startedAt: 'invalid',
            log: '../../.env',
          },
        },
        secret: 'must-not-be-accepted',
      }),
    );
    expect(() => readState(root)).toThrowError(
      expect.objectContaining({ code: 'SYSTEM_STATE_INVALID' }),
    );
  });
});
