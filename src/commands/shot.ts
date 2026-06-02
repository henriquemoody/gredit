import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { openSession } from '../session.ts';
import { dashFile, ensureDashboardsDir } from './paths.ts';

/** Screenshot the rendered dashboard to dashboardsDir/<uid>.png. */
export async function shot(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const session = await openSession(config);
  try {
    const url = `${config.baseUrl}/d/${uid}${config.shotKiosk ? '?kiosk' : ''}`;
    await session.page.goto(url, { waitUntil: 'networkidle' });
    await session.page.waitForTimeout(3000); // let panels finish querying

    // Grafana lazy-renders panels that are below the fold. Scroll through the
    // full page so every panel gets a chance to render before we screenshot.
    const viewportHeight = session.page.viewportSize()?.height ?? 800;
    let scrollY = 0;
    while (true) {
      const scrollHeight: number = await session.page.evaluate(() => document.body.scrollHeight);
      if (scrollY >= scrollHeight) break;
      await session.page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await session.page.waitForTimeout(500);
      scrollY += viewportHeight;
    }
    // Scroll back to top so fullPage screenshot starts from the beginning.
    await session.page.evaluate(() => window.scrollTo(0, 0));
    await session.page.waitForTimeout(1000);

    await ensureDashboardsDir(config);
    const out = dashFile(config, uid).replace(/\.json$/, '') + '.png';
    await session.page.screenshot({ path: out, fullPage: true });
    console.log(`Saved screenshot -> ${out}`);
    return 0;
  } finally {
    await session.close();
  }
}
