import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { Config } from '../config.ts';
import type { DashboardModel } from '../lint.ts';

export function dashFile(config: Config, uid: string): string {
  return resolve(process.cwd(), config.dashboardsDir, `${uid}.json`);
}

export function metaFile(config: Config, uid: string): string {
  return resolve(process.cwd(), config.dashboardsDir, `${uid}.meta.json`);
}

export async function ensureDashboardsDir(config: Config): Promise<void> {
  await mkdir(resolve(process.cwd(), config.dashboardsDir), { recursive: true });
}

export async function readModel(file: string): Promise<DashboardModel | null> {
  try {
    return (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return null;
  }
}

export const REAUTH_HINT = "Session looks unauthenticated — run 'gredit login' to log in via Okta.";
