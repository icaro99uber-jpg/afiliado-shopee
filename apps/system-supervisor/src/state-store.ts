import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { LocalSystemState, LogServiceName } from './types';
import { LocalSystemError, SERVICE_NAMES } from './types';

export const runtimeDirectory = (root: string) =>
  resolve(root, '.runtime', 'local-system');
export const statePath = (root: string) =>
  resolve(runtimeDirectory(root), 'state.json');
const lockPath = (root: string) => resolve(runtimeDirectory(root), 'lock');

export const ensureRuntimeDirectory = (root: string) =>
  mkdirSync(runtimeDirectory(root), { recursive: true });

export const relativeLogPath = (service: LogServiceName) =>
  `.runtime/local-system/${service}.log`;

export const absoluteLogPath = (root: string, service: LogServiceName) =>
  resolve(root, relativeLogPath(service));

export const rotateLogIfNeeded = (path: string, maximumBytes = 5_000_000) => {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || statSync(path).size <= maximumBytes) return;
  const rotated = `${path}.1`;
  rmSync(rotated, { force: true });
  renameSync(path, rotated);
};

export const appendSupervisorLog = (root: string, message: string) => {
  const path = absoluteLogPath(root, 'supervisor');
  rotateLogIfNeeded(path);
  writeFileSync(path, `${new Date().toISOString()} ${message}\n`, {
    flag: 'a',
  });
};

const isState = (value: unknown): value is LocalSystemState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const exactKeys = (
    record: Record<string, unknown>,
    keys: readonly string[],
  ) =>
    Object.keys(record).length === keys.length &&
    keys.every((key) => key in record);
  const validTimestamp = (timestamp: unknown) =>
    typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp));
  if (
    !exactKeys(state, ['version', 'startedAt', 'mode', 'ports', 'processes'])
  ) {
    return false;
  }
  if (
    state.version !== 1 ||
    !validTimestamp(state.startedAt) ||
    (state.mode !== 'preview' && state.mode !== 'send') ||
    !state.ports ||
    typeof state.ports !== 'object' ||
    !state.processes ||
    typeof state.processes !== 'object'
  ) {
    return false;
  }
  const ports = state.ports as Record<string, unknown>;
  const portNames = ['api', 'dashboard', 'postgres', 'redis', 'evolution'];
  if (
    !exactKeys(ports, portNames) ||
    !portNames.every(
      (name) =>
        Number.isInteger(ports[name]) &&
        (ports[name] as number) >= 1 &&
        (ports[name] as number) <= 65_535,
    )
  ) {
    return false;
  }
  const processes = state.processes as Record<string, unknown>;
  if (
    !Object.keys(processes).every((name) =>
      (SERVICE_NAMES as readonly string[]).includes(name),
    )
  ) {
    return false;
  }
  return Object.entries(processes).every(([name, processValue]) => {
    if (!processValue || typeof processValue !== 'object') return false;
    const registered = processValue as Record<string, unknown>;
    return (
      exactKeys(registered, ['pid', 'startedAt', 'log']) &&
      Number.isInteger(registered.pid) &&
      (registered.pid as number) > 0 &&
      validTimestamp(registered.startedAt) &&
      registered.log === relativeLogPath(name as LogServiceName)
    );
  });
};

export const readState = (root: string): LocalSystemState | null => {
  const path = statePath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isState(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new LocalSystemError(
      'Estado local invalido; remova-o somente apos conferir os processos',
      'SYSTEM_STATE_INVALID',
    );
  }
};

export const writeState = (root: string, state: LocalSystemState) => {
  ensureRuntimeDirectory(root);
  writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
};

export const clearState = (root: string) =>
  rmSync(statePath(root), { force: true });

export const acquireLock = (root: string) => {
  ensureRuntimeDirectory(root);
  let descriptor: number;
  for (let attempt = 0; ; attempt += 1) {
    try {
      descriptor = openSync(lockPath(root), 'wx', 0o600);
      writeFileSync(descriptor, String(process.pid));
      break;
    } catch {
      const registeredPid = Number(
        existsSync(lockPath(root))
          ? readFileSync(lockPath(root), 'utf8').trim()
          : Number.NaN,
      );
      let active = false;
      if (Number.isInteger(registeredPid) && registeredPid > 0) {
        try {
          process.kill(registeredPid, 0);
          active = true;
        } catch {
          active = false;
        }
      }
      if (active || attempt > 0) {
        throw new LocalSystemError(
          'Outra operacao do supervisor esta em andamento',
          'SYSTEM_OPERATION_IN_PROGRESS',
        );
      }
      rmSync(lockPath(root), { force: true });
    }
  }
  return () => {
    closeSync(descriptor);
    rmSync(lockPath(root), { force: true });
  };
};
