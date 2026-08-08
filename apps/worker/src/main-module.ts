import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const isMainModule = (
  importMetaUrl: string,
  argvEntry = process.argv[1],
): boolean =>
  typeof argvEntry === 'string' &&
  argvEntry.length > 0 &&
  pathToFileURL(resolve(argvEntry)).href === importMetaUrl;
