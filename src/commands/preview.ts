import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { openSession } from '../session.ts';

/** Open the dashboard in the browser for interactive preview. */
export async function preview(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const url = `${config.baseUrl}/d/${uid}`;
  const session = await openSession({ ...config, headless: false });
  try {
    await session.page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`Previewing ${url}`);
    console.log('Press Enter to close the browser.');
    await new Promise<void>((res) => process.stdin.once('data', () => res()));
    return 0;
  } finally {
    await session.close();
  }
}
