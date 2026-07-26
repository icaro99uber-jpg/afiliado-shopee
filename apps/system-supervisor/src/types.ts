export const SERVICE_NAMES = [
  'api',
  'dashboard',
  'commercial-worker',
  'whatsapp-dispatch-worker',
] as const;

export const LOG_SERVICE_NAMES = [...SERVICE_NAMES, 'supervisor'] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type LogServiceName = (typeof LOG_SERVICE_NAMES)[number];
export type AutomationMode = 'preview' | 'send';

export type RegisteredProcess = {
  pid: number;
  startedAt: string;
  log: string;
};

export type LocalSystemState = {
  version: 1;
  startedAt: string;
  mode: AutomationMode;
  ports: {
    api: number;
    dashboard: number;
    postgres: number;
    redis: number;
    evolution: number;
  };
  processes: Partial<Record<ServiceName, RegisteredProcess>>;
};

export type CommandSpec = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
};

export type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type ProcessInspection = {
  running: boolean;
  identityMatches: boolean;
  command?: string;
  startedAt?: string;
};

export type PortOccupant = {
  pid?: number;
  processName: string;
};

export type StartedProcess = {
  pid: number;
  startedAt: string;
};

export type SystemDependencies = {
  run(spec: CommandSpec): Promise<CommandResult>;
  spawn(spec: CommandSpec & { logPath: string }): Promise<StartedProcess>;
  inspectProcess(
    pid: number,
    expectedMarker: string,
    expectedStartedAt: string,
  ): Promise<ProcessInspection>;
  stopProcessTree(pid: number): Promise<boolean>;
  getPortOccupant(port: number): Promise<PortOccupant | null>;
  request(
    url: string,
    options?: { headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; body?: unknown }>;
  sleep(milliseconds: number): Promise<void>;
  now(): Date;
};

export class LocalSystemError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'LocalSystemError';
  }
}
