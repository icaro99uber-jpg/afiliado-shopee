import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { SHOPEE_AFFILIATE_OFFICIAL_API_URL } from '@shopee-auto-affiliate-ai/providers';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG_KEYS = [
  'SHOPEE_AFFILIATE_PROVIDER',
  'SHOPEE_AFFILIATE_API_ENABLED',
  'SHOPEE_AFFILIATE_APP_ID',
  'SHOPEE_AFFILIATE_SECRET',
  'SHOPEE_AFFILIATE_API_URL',
] as const;

type OfficialCredentials = { appId: string; secret: string };

const safeError = (code: string, message: string) =>
  new AppError(message, code);

export const assertRootEnvIgnored = (root = REPOSITORY_ROOT) => {
  const result = spawnSync('git', ['check-ignore', '--quiet', '.env'], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw safeError(
      'SHOPEE_OFFICIAL_ENV_NOT_IGNORED',
      'O arquivo .env raiz nao esta ignorado pelo Git',
    );
  }
};

const serializeEnvValue = (value: string) => {
  if (!value || /[\r\n\0]/.test(value)) {
    throw safeError(
      'SHOPEE_OFFICIAL_CREDENTIAL_INVALID',
      'Credencial oficial invalida',
    );
  }
  if (/^[A-Za-z0-9._~+/=-]+$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw safeError(
    'SHOPEE_OFFICIAL_CREDENTIAL_FORMAT_UNSUPPORTED',
    'Formato de credencial nao suportado pelo arquivo local',
  );
};

export const updateOfficialEnvContents = (
  contents: string,
  credentials: OfficialCredentials,
) => {
  const values: Record<(typeof CONFIG_KEYS)[number], string> = {
    SHOPEE_AFFILIATE_PROVIDER: 'official',
    SHOPEE_AFFILIATE_API_ENABLED: 'true',
    SHOPEE_AFFILIATE_APP_ID: serializeEnvValue(credentials.appId.trim()),
    SHOPEE_AFFILIATE_SECRET: serializeEnvValue(credentials.secret.trim()),
    SHOPEE_AFFILIATE_API_URL: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
  };
  const seen = new Set<string>();
  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/);
  const updated = lines.flatMap((line) => {
    const match = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = match?.[2] as (typeof CONFIG_KEYS)[number] | undefined;
    if (!key || !CONFIG_KEYS.includes(key)) return [line];
    if (seen.has(key)) return [];
    seen.add(key);
    return [`${match?.[1] ?? ''}${key}=${values[key]}`];
  });
  for (const key of CONFIG_KEYS) {
    if (!seen.has(key)) updated.push(`${key}=${values[key]}`);
  }
  return `${updated.join(newline).replace(/(?:\r?\n)+$/, '')}${newline}`;
};

const writeAtomicUtf8 = (path: string, contents: string) => {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.tmp`,
  );
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // No Windows, a ACL local existente continua sendo a protecao efetiva.
  }
};

const readHiddenLine = (label: string): Promise<string> => {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    !process.stdin.setRawMode
  ) {
    throw safeError(
      'SHOPEE_OFFICIAL_INTERACTIVE_TERMINAL_REQUIRED',
      'Terminal interativo local obrigatorio',
    );
  }
  process.stdout.write(label);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolveValue, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolveValue(value);
    };
    const onData = (chunk: string | Buffer) => {
      const input = String(chunk);
      for (const character of input) {
        if (character === '\u0003') {
          finish(
            safeError(
              'SHOPEE_OFFICIAL_CONFIGURATION_CANCELLED',
              'Configuracao cancelada',
            ),
          );
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\b' || character === '\u007f') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
};

export const configureShopeeOfficial = async ({
  args = process.argv.slice(2),
  env = process.env,
  root = REPOSITORY_ROOT,
  prompt = async (): Promise<OfficialCredentials> => ({
    appId: await readHiddenLine('App ID (entrada oculta): '),
    secret: await readHiddenLine('Secret (entrada oculta): '),
  }),
}: {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  root?: string;
  prompt?: () => Promise<OfficialCredentials>;
} = {}) => {
  if (env.CI) {
    throw safeError(
      'SHOPEE_OFFICIAL_CI_BLOCKED',
      'Configuracao oficial bloqueada em CI',
    );
  }
  if (args.length > 0) {
    throw safeError(
      'SHOPEE_OFFICIAL_CONFIGURATION_ARGUMENTS_BLOCKED',
      'A configuracao oficial nao aceita argumentos',
    );
  }
  assertRootEnvIgnored(root);
  const envPath = join(resolve(root), '.env');
  const credentials = await prompt();
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  writeAtomicUtf8(envPath, updateOfficialEnvContents(current, credentials));
  return {
    configured: true,
    provider: 'official' as const,
    apiEnabled: true,
    apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
    envFile: '.env',
    credentialsPrinted: false,
  };
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  configureShopeeOfficial()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          configured: false,
          code:
            error instanceof AppError
              ? error.code
              : 'SHOPEE_OFFICIAL_CONFIGURATION_FAILED',
        }),
      );
      process.exitCode = 1;
    });
}
