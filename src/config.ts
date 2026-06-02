import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Per-project configuration. The shared `gredit` binary reads this from
 * the current working directory, so each dashboard repo carries its own config.
 */
export interface Config {
  /** Base URL of the Grafana instance, e.g. https://grafana.company.com */
  baseUrl: string;
  /** Directory holding the persistent browser profile (session cookies). */
  profileDir: string;
  /** Directory where dashboard JSON models are read from / written to. */
  dashboardsDir: string;
  /** Default dashboard uid used when a command is invoked without one. */
  uid?: string | undefined;
  /** Optional alias -> uid map so commands can take a friendly name. */
  dashboards?: Record<string, string> | undefined;
  /** Run screenshots in Grafana kiosk mode (hides chrome). Default true. */
  shotKiosk: boolean;
  /** Whether browser commands run headless. Default false (Okta is headful). */
  headless: boolean;
}

const CONFIG_FILES = ['gredit.dist.json', 'gredit.json', 'gredit.local.json'];

const DEFAULTS = {
  profileDir: '.gredit-profile',
  dashboardsDir: 'dashboards',
  shotKiosk: true,
  headless: false,
};

export function configPath(cwd = process.cwd()): string {
  return resolve(cwd, 'gredit.json');
}

/**
 * Load and validate config from the current directory. Files are merged in
 * order: gredit.dist.json < gredit.json < gredit.local.json.
 * Environment variables override all file values:
 *   GRAFANA_BASE_URL, GRAFANA_PROFILE_DIR, GRAFANA_DASHBOARDS_DIR,
 *   GRAFANA_UID, GRAFANA_HEADLESS (=1)
 */
export async function loadConfig(cwd = process.cwd()): Promise<Config> {
  let fileConfig: Partial<Config> = {};

  for (const file of CONFIG_FILES) {
    const path = resolve(cwd, file);
    if (existsSync(path)) {
      try {
        const parsed = (await Bun.file(path).json()) as Partial<Config>;
        fileConfig = { ...fileConfig, ...parsed };
      } catch (err) {
        throw new ConfigError(`Could not parse ${file}: ${(err as Error).message}`);
      }
    }
  }

  const env = process.env;
  const merged: Config = {
    baseUrl: env.GRAFANA_BASE_URL ?? fileConfig.baseUrl ?? '',
    profileDir: env.GRAFANA_PROFILE_DIR ?? fileConfig.profileDir ?? DEFAULTS.profileDir,
    dashboardsDir: env.GRAFANA_DASHBOARDS_DIR ?? fileConfig.dashboardsDir ?? DEFAULTS.dashboardsDir,
    uid: env.GRAFANA_UID ?? fileConfig.uid,
    dashboards: fileConfig.dashboards,
    shotKiosk: fileConfig.shotKiosk ?? DEFAULTS.shotKiosk,
    headless: env.GRAFANA_HEADLESS === '1' ? true : (fileConfig.headless ?? DEFAULTS.headless),
  };

  if (!merged.baseUrl) {
    throw new ConfigError(
      `No baseUrl set. Create gredit.json (see 'gredit help') or set GRAFANA_BASE_URL.`,
    );
  }
  // Normalize: strip trailing slash so URL joins are predictable.
  merged.baseUrl = merged.baseUrl.replace(/\/+$/, '');

  return merged;
}

/**
 * Resolve a command argument to a dashboard uid. Accepts either a raw uid, an
 * alias defined in config.dashboards, or nothing (falls back to config.uid).
 */
export function resolveUid(config: Config, arg?: string): string {
  if (arg) {
    if (config.dashboards && arg in config.dashboards) return config.dashboards[arg]!;
    return arg;
  }
  if (config.uid) return config.uid;
  throw new ConfigError(
    "No dashboard uid given and no default 'uid' in config. Pass one: gredit pull <uid>",
  );
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}
