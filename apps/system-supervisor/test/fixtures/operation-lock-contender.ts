import { setTimeout as delay } from 'node:timers/promises';

import { acquireLock } from '../../src/state-store';
import { createSystemDependencies } from '../../src/system-dependencies';
import { LocalSystemError } from '../../src/types';

const root = process.argv[2];
if (!root) throw new Error('Missing test root');

try {
  const release = await acquireLock(root, 'start', createSystemDependencies());
  process.stdout.write('acquired\n');
  await delay(10_000);
  release();
} catch (error) {
  if (!(error instanceof LocalSystemError)) throw error;
  process.stdout.write(`${error.code}\n`);
}
