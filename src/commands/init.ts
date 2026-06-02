import { loadConfig, configPath } from '../config.ts';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { login } from './auth.ts';
import { withConfig } from '../runtime.ts';

/** Interactive wizard that creates gredit.json, then runs login. */
export async function init(): Promise<number> {
  const cfgFile = configPath();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));

  try {
    if (existsSync(cfgFile)) {
      const ans = await ask('gredit.json already exists. Overwrite? [y/N] ');
      if (!ans.toLowerCase().startsWith('y')) {
        console.log('Aborted.');
        return 0;
      }
    }

    console.log('\nSet up gredit — press Enter to accept defaults.\n');

    let baseUrl = '';
    while (!baseUrl) {
      baseUrl = await ask('Grafana base URL (e.g. https://grafana.company.com): ');
      if (!baseUrl) console.error('  baseUrl is required.');
    }
    baseUrl = baseUrl.replace(/\/+$/, '');

    const profileDir =
      (await ask('Session profile directory [.gredit-profile]: ')) || '.gredit-profile';
    const dashboardsDir = (await ask('Dashboards directory [dashboards]: ')) || 'dashboards';
    const uid = await ask('Default dashboard UID (optional, press Enter to skip): ');

    const shotKioskAns = (await ask('Screenshot in kiosk mode? [Y/n] ')) || 'y';
    const shotKiosk = shotKioskAns.toLowerCase().startsWith('y');

    const cfg: Record<string, unknown> = {
      baseUrl,
      profileDir,
      dashboardsDir,
      shotKiosk,
      headless: false,
    };
    if (uid) cfg.uid = uid;

    await Bun.write(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`\nCreated gredit.json.`);
  } finally {
    rl.close();
  }

  console.log('Starting login...\n');
  return withConfig(login);
}
