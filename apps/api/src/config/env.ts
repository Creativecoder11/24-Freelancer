import * as fs from 'node:fs';
import * as path from 'node:path';
import { envSchema, type Env } from './env.schema';

/**
 * Loads `.env` files (without overriding real environment variables), then validates.
 * Order: apps/api/.env.local, apps/api/.env, repo-root .env.
 */
function loadDotEnvFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/api/.env.local'),
    path.resolve(process.cwd(), 'apps/api/.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

let cached: Env | null = null;

/** Validated environment. Throws a readable error listing every bad variable. */
export function getEnv(): Env {
  if (cached) return cached;
  loadDotEnvFiles();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: drop the cache so a test can change process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const ENV = Symbol('ENV');
