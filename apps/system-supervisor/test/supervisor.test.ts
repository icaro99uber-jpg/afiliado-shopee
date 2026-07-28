import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { statePath } from '../src/state-store';
import { LocalSystemSupervisor } from '../src/supervisor';
import type {
  CommandSpec,
  PortOccupant,
  ServiceName,
  SystemDependencies,
} from '../src/types';

const directories: string[] = [];
const requiredFiles = [
  '.env',
  'package.json',
  'pnpm-lock.yaml',
  'docker-compose.yml',
  'infra/evolution/docker-compose.yml',
  'apps/api/src/server.ts',
  'apps/dashboard/package.json',
  'apps/worker/src/commercial-automation-worker.ts',
  'apps/worker/src/whatsapp-dispatch-runtime.ts',
];

const createRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'local-system-supervisor-'));
  directories.push(root);
  for (const file of requiredFiles) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '{}');
  }
  return root;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const specs = (
  [
    ['api', 'api-entry', 'http://api/health'],
    ['dashboard', 'dashboard-entry', 'http://dashboard'],
    ['commercial-worker', 'commercial-entry'],
    ['whatsapp-dispatch-worker', 'dispatch-entry'],
  ] as const
).map(([name, marker, healthUrl]) => ({
  name,
  command: 'node',
  args: [marker],
  marker,
  ...(name === 'dashboard' ? { cwd: 'dashboard-root' } : {}),
  ...(healthUrl ? { healthUrl: () => healthUrl } : {}),
}));

const composeLines = (evolution: boolean) =>
  (evolution
    ? ['evolution-api', 'evolution-postgres', 'evolution-redis']
    : ['postgres', 'redis']
  )
    .map((service) =>
      JSON.stringify({ Service: service, State: 'running', Health: 'healthy' }),
    )
    .join('\n');

const harness = (
  options: {
    dockerAvailable?: boolean;
    infrastructureHealthFails?: boolean;
    migrationFails?: boolean;
    healthFails?: boolean;
    dieAfterInitialInspection?: ServiceName;
    portOccupants?: Record<number, PortOccupant>;
  } = {},
) => {
  let nextPid = 100;
  let mainRunning = false;
  let evolutionRunning = false;
  const processes = new Map<
    number,
    { running: boolean; marker: string; startedAt: string; matches: boolean }
  >();
  const commands: CommandSpec[] = [];
  const stopped: number[] = [];
  const spawned: ServiceName[] = [];
  const spawnedCwds = new Map<ServiceName, string>();
  const inspectionCounts = new Map<number, number>();
  const run = vi.fn(async (spec: CommandSpec) => {
    commands.push(spec);
    if (spec.args.length === 1 && spec.args[0] === 'info') {
      return {
        code: options.dockerAvailable === false ? 1 : 0,
        stdout: '',
        stderr: '',
      };
    }
    const evolution = spec.args.includes('infra/evolution/docker-compose.yml');
    if (spec.args.includes('up') || spec.args.includes('evolution:up')) {
      if (spec.args.includes('evolution:up')) evolutionRunning = true;
      else mainRunning = true;
    }
    if (spec.args.includes('stop')) {
      if (evolution) evolutionRunning = false;
      else mainRunning = false;
    }
    if (spec.args.includes('ps')) {
      const running = evolution ? evolutionRunning : mainRunning;
      return {
        code: 0,
        stdout:
          running && !options.infrastructureHealthFails
            ? composeLines(evolution)
            : '',
        stderr: '',
      };
    }
    if (spec.args.includes('db:deploy') && options.migrationFails) {
      return { code: 1, stdout: '', stderr: 'migration failed' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  const deps: SystemDependencies = {
    run,
    spawn: vi.fn(async (spec) => {
      const pid = nextPid++;
      const startedAt = `2026-07-25T12:00:${String(pid - 100).padStart(2, '0')}.000Z`;
      const marker = spec.args[0];
      processes.set(pid, { running: true, marker, startedAt, matches: true });
      const name = specs.find((item) => item.marker === marker)
        ?.name as ServiceName;
      spawned.push(name);
      spawnedCwds.set(name, spec.cwd);
      return { pid, startedAt };
    }),
    inspectProcess: vi.fn(async (pid, marker) => {
      const item = processes.get(pid);
      const inspectionCount = (inspectionCounts.get(pid) ?? 0) + 1;
      inspectionCounts.set(pid, inspectionCount);
      const name = specs.find((spec) => spec.marker === marker)?.name;
      if (
        name === options.dieAfterInitialInspection &&
        inspectionCount > 1 &&
        item
      ) {
        item.running = false;
      }
      return {
        running: item?.running ?? false,
        identityMatches: Boolean(item?.matches && item.marker === marker),
        startedAt: item?.startedAt,
      };
    }),
    stopProcessTree: vi.fn(async (pid) => {
      stopped.push(pid);
      const item = processes.get(pid);
      if (item) item.running = false;
      return true;
    }),
    getPortOccupant: vi.fn(
      async (port) => options.portOccupants?.[port] ?? null,
    ),
    request: vi.fn(async (url) => {
      if (
        options.healthFails &&
        (url === 'http://api/health' || url === 'http://dashboard')
      ) {
        return { ok: false, status: 503 };
      }
      if (url.endsWith('/scheduler')) {
        return {
          ok: true,
          status: 200,
          body: { status: 'disabled', enabled: false },
        };
      }
      if (url.endsWith('/commercial-automation/status')) {
        return {
          ok: true,
          status: 200,
          body: {
            enabled: false,
            paused: true,
            allowed: false,
            reasons: ['AUTOMATION_DISABLED'],
            nextAllowedAt: null,
          },
        };
      }
      return { ok: true, status: 200, body: { status: 'ok' } };
    }),
    sleep: vi.fn(async () => undefined),
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  };
  return {
    deps,
    commands,
    processes,
    spawned,
    spawnedCwds,
    stopped,
    setInfrastructure: (running: boolean) => {
      mainRunning = running;
      evolutionRunning = running;
    },
  };
};

const environment = (mode: 'preview' | 'send' = 'preview') => ({
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  COMMERCIAL_AUTOMATION_MODE: mode,
  ...(mode === 'send'
    ? {
        SHOPEE_AFFILIATE_PROVIDER: 'official',
        SHOPEE_AFFILIATE_API_ENABLED: 'true',
        SHOPEE_AFFILIATE_API_URL: 'https://example.test',
        SHOPEE_AFFILIATE_APP_ID: 'private',
        SHOPEE_AFFILIATE_SECRET: 'private',
        WHATSAPP_PROVIDER: 'evolution',
        EVOLUTION_API_URL: 'http://localhost:8080',
        EVOLUTION_API_KEY: 'private',
        EVOLUTION_INSTANCE_NAME: 'private',
        WHATSAPP_GROUP_SEND_ENABLED: 'true',
      }
    : {}),
});

const createSupervisor = (root: string, deps: SystemDependencies) =>
  new LocalSystemSupervisor(root, deps, specs, { validateRoot: () => true });

describe('LocalSystemSupervisor', () => {
  it('starts the safe preview topology in order without legacy worker, tick or send', async () => {
    const root = createRoot();
    const state = harness();
    const status = await createSupervisor(root, state.deps).start(
      environment(),
    );

    expect(status.overall).toBe('running');
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
    expect(state.spawnedCwds.get('dashboard')).toBe('dashboard-root');
    expect(state.commands.some((item) => item.args.includes('dev'))).toBe(
      false,
    );
    expect(
      state.commands.some((item) =>
        item.args.some((arg) => /tick|confirm|send/i.test(arg)),
      ),
    ).toBe(false);
    const persisted = readFileSync(statePath(root), 'utf8');
    expect(persisted).not.toContain('private');
    expect(persisted).not.toContain('DATABASE_URL');
  });

  it('adds only the isolated dispatch worker in send mode', async () => {
    const root = createRoot();
    const state = harness();
    await createSupervisor(root, state.deps).start(environment('send'));
    expect(state.spawned).toEqual([
      'api',
      'dashboard',
      'commercial-worker',
      'whatsapp-dispatch-worker',
    ]);
  });

  it('preserves ownership and rejects a dispatch worker registered in preview', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment('send'));
    const persisted = JSON.parse(readFileSync(statePath(root), 'utf8')) as {
      mode: string;
    };
    persisted.mode = 'preview';
    writeFileSync(statePath(root), JSON.stringify(persisted));

    await expect(
      supervisor.start(environment('preview')),
    ).rejects.toMatchObject({ code: 'SYSTEM_UNEXPECTED_REGISTERED_PROCESS' });
    expect(readFileSync(statePath(root), 'utf8')).toContain(
      'whatsapp-dispatch-worker',
    );
  });

  it('is idempotent and does not duplicate healthy children', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    await supervisor.start(environment());
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
  });

  it('recovers stale registrations without killing a reused PID', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const oldApi = [...state.processes.entries()][0];
    oldApi[1].matches = false;

    await supervisor.start(environment());

    expect(state.spawned.filter((name) => name === 'api')).toHaveLength(2);
    expect(state.stopped).not.toContain(oldApi[0]);
  });

  it('fails safely when Docker is unavailable or an external port is occupied', async () => {
    const dockerRoot = createRoot();
    const docker = harness({ dockerAvailable: false });
    await expect(
      createSupervisor(dockerRoot, docker.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'DOCKER_DAEMON_UNAVAILABLE' });
    expect(docker.spawned).toEqual([]);

    const portRoot = createRoot();
    const port = harness({
      portOccupants: { 3333: { pid: 55, processName: 'external-api' } },
    });
    await expect(
      createSupervisor(portRoot, port.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_PORT_OCCUPIED' });
    expect(port.stopped).toEqual([]);
  });

  it('requires the ignored root env before starting anything', async () => {
    const root = createRoot();
    rmSync(join(root, '.env'));
    const state = harness();

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_REQUIRED_FILE_MISSING' });
    expect(state.commands).toEqual([]);
    expect(state.spawned).toEqual([]);
  });

  it('fails before spawning children when infrastructure stays unhealthy', async () => {
    const root = createRoot();
    const state = harness({ infrastructureHealthFails: true });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'MAIN_COMPOSE_UNHEALTHY' });
    expect(state.spawned).toEqual([]);
  });

  it('fails before spawning children when migrate deploy fails', async () => {
    const root = createRoot();
    const state = harness({ migrationFails: true });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'PRISMA_MIGRATE_DEPLOY_FAILED' });
    expect(state.spawned).toEqual([]);
  });

  it('rolls back only children started by a failed attempt', async () => {
    const root = createRoot();
    const state = harness({ healthFails: true });
    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'API_UNHEALTHY' });
    expect(state.spawned).toEqual(['api']);
    expect(state.stopped).toEqual([100]);
    expect(() => readFileSync(statePath(root), 'utf8')).toThrow();
  });

  it('rolls back when a child dies after its initial readiness check', async () => {
    const root = createRoot();
    const state = harness({
      dieAfterInitialInspection: 'commercial-worker',
    });

    await expect(
      createSupervisor(root, state.deps).start(environment()),
    ).rejects.toMatchObject({ code: 'SYSTEM_START_INCOMPLETE' });
    expect(state.spawned).toEqual(['api', 'dashboard', 'commercial-worker']);
    expect(state.stopped).toEqual([101, 100]);
    expect(() => readFileSync(statePath(root), 'utf8')).toThrow();
  });

  it('reports partial status without throwing', async () => {
    const root = createRoot();
    const state = harness();
    state.setInfrastructure(true);
    const status = await createSupervisor(root, state.deps).status(
      environment(),
    );
    expect(status.overall).toBe('partial');
    expect(status.processes.api).toBe('stopped');
    expect(status.processes['whatsapp-dispatch-worker']).toBe('not-required');
    expect(status.schedulers.legacy).toEqual({
      enabled: null,
      status: 'unavailable',
      cronExpression: null,
      timezone: null,
      nextRunAt: null,
    });
  });

  it('stops only validated registered processes and preserves state on PID mismatch', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    const api = [...state.processes.entries()][0];
    api[1].matches = false;

    const result = await supervisor.stop(environment());

    expect(result.stopped).toBe(false);
    expect(result.manualIntervention).toContain(
      'api: PID reutilizado ou divergente',
    );
    expect(state.stopped).not.toContain(api[0]);
    expect(readFileSync(statePath(root), 'utf8')).toContain('"api"');
  });

  it('stops idempotently, preserves Docker data and clears confirmed state', async () => {
    const root = createRoot();
    const state = harness();
    const supervisor = createSupervisor(root, state.deps);
    await supervisor.start(environment());
    await expect(supervisor.stop(environment())).resolves.toEqual({
      stopped: true,
      manualIntervention: [],
    });
    await expect(supervisor.stop(environment())).resolves.toEqual({
      stopped: true,
      manualIntervention: [],
    });
    expect(state.commands.some((item) => item.args.includes('-v'))).toBe(false);
    expect(() => readFileSync(statePath(root), 'utf8')).toThrow();
  });
});
