import fs from 'node:fs';
import dotenv from 'dotenv';

export interface LoadServerEnvironmentOptions {
  rootPath: string;
  legacyPath: string;
  target?: NodeJS.ProcessEnv;
}

export interface LoadedServerEnvironment {
  rootLoaded: boolean;
  legacyLoaded: boolean;
  rootPath: string;
  legacyPath: string;
}

function loadFile(filePath: string, target: NodeJS.ProcessEnv): boolean {
  if (!fs.existsSync(filePath)) return false;
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) target[key] = value;
  }
  return true;
}

export function loadServerEnvironment({
  rootPath,
  legacyPath,
  target = process.env
}: LoadServerEnvironmentOptions): LoadedServerEnvironment {
  const rootLoaded = loadFile(rootPath, target);
  const legacyLoaded = loadFile(legacyPath, target);
  return { rootLoaded, legacyLoaded, rootPath, legacyPath };
}
