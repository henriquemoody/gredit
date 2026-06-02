import type { Config } from '../config.ts';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { openSession } from '../session.ts';

/** One-time, headful Okta login. Holds the browser open until the user is done. */
export async function login(config: Config): Promise<number> {
  if (config.headless) {
    console.warn('Note: headless is enabled; Okta login usually needs a visible window.');
  }
  const session = await openSession(config);
  console.log(`Opened ${config.baseUrl}.`);
  console.log(
    'Complete the Okta login in the browser window, then press Enter here to save the session.',
  );
  await new Promise<void>((res) => process.stdin.once('data', () => res()));
  await session.close();
  console.log(`Session saved to ${config.profileDir}.`);
  return 0;
}

/** Remove the stored session. Run before login to start fresh. */
export async function logout(config: Config): Promise<number> {
  const profile = resolve(process.cwd(), config.profileDir);
  await rm(profile, { recursive: true, force: true });
  console.log(`Logged out — session removed from ${config.profileDir}.`);
  return 0;
}
