import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const examplePath = fileURLToPath(new URL('.env.example', import.meta.url));
const localPath = fileURLToPath(new URL('.env.local', import.meta.url));

if (existsSync(localPath)) {
  console.log('Evolution local config already exists; keeping it unchanged.');
  process.exit(0);
}

const apiKey = randomBytes(32).toString('base64url');
const postgresPassword = randomBytes(32).toString('base64url');
const connectionPassword = encodeURIComponent(postgresPassword);

const localConfig = readFileSync(examplePath, 'utf8')
  .replace(/^AUTHENTICATION_API_KEY=.*$/m, `AUTHENTICATION_API_KEY=${apiKey}`)
  .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${postgresPassword}`)
  .replace(
    /^DATABASE_CONNECTION_URI=.*$/m,
    `DATABASE_CONNECTION_URI=postgresql://evolution:${connectionPassword}@evolution-postgres:5432/evolution?schema=evolution_api`,
  );

writeFileSync(localPath, localConfig, {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
});

console.log('Created ignored Evolution local config with generated secrets.');
