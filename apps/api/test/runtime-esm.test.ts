import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectory = resolve(apiDirectory, '../..');
const runtimeTsconfig = resolve(workspaceDirectory, 'tsconfig.runtime.json');
const serverEntry = resolve(apiDirectory, 'src/server.ts');

const delay = (milliseconds: number) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const getFreePort = async () => {
  const probe = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') {
    probe.close();
    throw new Error('Nao foi possivel reservar uma porta para o smoke test');
  }
  await new Promise<void>((resolveClose, rejectClose) =>
    probe.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
};

const controlledEnvironment = (port: number): NodeJS.ProcessEnv => {
  const systemKeys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'ComSpec',
    'COMSPEC',
  ];
  const environment = Object.fromEntries(
    systemKeys.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
  return {
    ...environment,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: 'postgresql://runtime:runtime@127.0.0.1:1/runtime',
    REDIS_URL: 'redis://127.0.0.1:1',
    WHATSAPP_PROVIDER: 'mock',
    EVOLUTION_SAFE_MODE: 'true',
    EVOLUTION_ALLOWED_DESTINATIONS: '',
    EVOLUTION_MAX_MESSAGES_PER_BOOT: '1',
    WHATSAPP_GROUP_SEND_ENABLED: 'false',
    WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
    SCHEDULER_ENABLED: 'false',
    TSX_TSCONFIG_PATH: runtimeTsconfig,
  };
};

const sanitizeOutput = (output: string) =>
  output
    .replace(/postgresql:\/\/[^\s"']+/giu, '[DATABASE_URL]')
    .replace(/redis:\/\/[^\s"']+/giu, '[REDIS_URL]')
    .slice(-4_000);

describe('API ESM runtime', () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await Promise.race([once(child, 'exit'), delay(5_000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  it('mantem todos os entrypoints tsx no tsconfig de runtime', async () => {
    const apiPackage = JSON.parse(
      await readFile(resolve(apiDirectory, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const workerPackage = JSON.parse(
      await readFile(
        resolve(workspaceDirectory, 'apps/worker/package.json'),
        'utf8',
      ),
    ) as { scripts: Record<string, string> };

    expect(apiPackage.scripts.dev).toContain(
      '--tsconfig ../../tsconfig.runtime.json',
    );
    for (const script of [
      'dev',
      'evolution:test-message',
      'whatsapp:e2e-test',
      'whatsapp:group-test',
    ]) {
      expect(workerPackage.scripts[script]).toContain(
        '--tsconfig ../../tsconfig.runtime.json',
      );
    }
  });

  it('inicia via tsx, preserva AppError e responde GET /health', async () => {
    const port = await getFreePort();
    let output = '';
    const serverProcess = spawn(
      process.execPath,
      ['--import', 'tsx', serverEntry],
      {
        cwd: apiDirectory,
        env: controlledEnvironment(port),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child = serverProcess;
    serverProcess.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    serverProcess.stderr.on('data', (chunk) => {
      output += String(chunk);
    });

    const deadline = Date.now() + 15_000;
    let response: Response | undefined;
    while (Date.now() < deadline && serverProcess.exitCode === null) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`);
        break;
      } catch {
        await delay(100);
      }
    }

    if (!response) {
      throw new Error(
        `API nao iniciou no smoke test. Saida sanitizada:\n${sanitizeOutput(output)}`,
      );
    }
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'api' });
    await delay(100);
    expect(serverProcess.exitCode).toBeNull();
    expect(output).not.toContain('does not provide an export named');
  }, 25_000);
});
