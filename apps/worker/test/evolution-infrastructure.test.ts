import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const readRepositoryFile = (path: string) =>
  readFileSync(`${repositoryRoot}${path}`, 'utf8');

const compose = readRepositoryFile('infra/evolution/docker-compose.yml');
const envExample = readRepositoryFile('infra/evolution/.env.example');
const initScript = readRepositoryFile('infra/evolution/init-local-env.mjs');
const gitignore = readRepositoryFile('.gitignore');
const packageJson = JSON.parse(readRepositoryFile('package.json')) as {
  scripts: Record<string, string>;
};

describe('Evolution local infrastructure', () => {
  it('fixa todas as imagens sem latest', () => {
    expect(compose).toContain('evoapicloud/evolution-api:v2.3.6');
    expect(compose).toContain('postgres:16.4-alpine3.20');
    expect(compose).toContain('redis:7.2.5-alpine3.20');
    expect(compose).not.toMatch(/image:\s*\S+:latest/);
  });

  it('publica somente a API em loopback', () => {
    expect(compose).toContain('127.0.0.1:${EVOLUTION_HOST_PORT:-8080}:8080');
    expect(compose.match(/\n\s+ports:/g)).toHaveLength(1);
    expect(compose).not.toMatch(/["'](?:5432|6379):(?:5432|6379)["']/);
  });

  it('usa configuracao local ignorada e healthchecks', () => {
    expect(compose).toMatch(/env_file:\s*\n\s+- \.env\.local/);
    expect(compose.match(/\n\s+healthcheck:/g)).toHaveLength(3);
    expect(gitignore).toContain('infra/evolution/.env.local');
    expect(envExample).toContain(
      'AUTHENTICATION_API_KEY=replace-with-generated-api-key',
    );
    expect(envExample).toContain(
      'POSTGRES_PASSWORD=replace-with-generated-postgres-password',
    );
    expect(envExample).not.toMatch(
      /^(?:AUTHENTICATION_TYPE|DATABASE_ENABLED)=/m,
    );
    expect(initScript).toContain('randomBytes(32)');
    expect(initScript).toContain("flag: 'wx'");
  });

  it('oferece scripts Windows via pnpm para o compose isolado', () => {
    for (const name of [
      'evolution:up',
      'evolution:down',
      'evolution:status',
      'evolution:logs',
      'evolution:restart',
    ]) {
      expect(packageJson.scripts[name]).toContain(
        '--env-file infra/evolution/.env.local',
      );
      expect(packageJson.scripts[name]).toContain(
        '-f infra/evolution/docker-compose.yml',
      );
    }
    expect(packageJson.scripts['evolution:config']).toContain('config --quiet');
    expect(packageJson.scripts['evolution:logs']).toContain('logs --tail=200');
    expect(packageJson.scripts['evolution:logs']).not.toContain('config');
  });

  it('executa o teste isolado pela raiz usando corepack no Windows', () => {
    expect(packageJson.scripts['evolution:test-message']).toBe(
      'corepack pnpm --filter @shopee-auto-affiliate-ai/worker evolution:test-message',
    );
    expect(packageJson.scripts['evolution:test-message']).not.toMatch(
      /^pnpm\s/,
    );
  });

  it('nao automatiza instancia, QR Code, envio, pipeline ou Scheduler', () => {
    const infrastructure = `${compose}\n${envExample}\n${JSON.stringify(
      packageJson.scripts,
    )}`;
    expect(infrastructure).not.toMatch(
      /instance\/create|instance\/connect|message\/sendText|--confirm-one-real-message|pipeline\/run/i,
    );
    expect(envExample).not.toContain('SCHEDULER_ENABLED=true');
    expect(compose).not.toMatch(
      /privileged:|network_mode:\s*host|\/var\/run\/docker\.sock/i,
    );
  });
});
