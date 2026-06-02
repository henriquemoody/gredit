import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { openSession, looksUnauthenticated } from '../session.ts';
import { lintDashboard, type DashboardModel } from '../lint.ts';
import { dashFile, metaFile, readModel, REAUTH_HINT, ensureDashboardsDir } from './paths.ts';

/** Download a dashboard model and write it to dashboardsDir/<uid>.json. */
export async function pull(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const session = await openSession(config);
  try {
    const res = await session.apiFetch<{
      dashboard: DashboardModel;
      meta?: { folderUid?: string };
    }>(`/api/dashboards/uid/${uid}`);
    if (looksUnauthenticated(res)) {
      console.error(REAUTH_HINT);
      return 2;
    }
    if (!res.ok) {
      console.error(`Pull failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
      return 1;
    }
    const { dashboard, meta } = res.body;
    await ensureDashboardsDir(config);
    const out = dashFile(config, uid);
    await Bun.write(out, JSON.stringify(dashboard, null, 2) + '\n');
    if (meta?.folderUid) {
      await Bun.write(
        metaFile(config, uid),
        JSON.stringify({ folderUid: meta.folderUid }, null, 2) + '\n',
      );
    }
    console.log(`Pulled ${uid} -> ${config.dashboardsDir}/${uid}.json`);
    return 0;
  } finally {
    await session.close();
  }
}

export interface PushOptions {
  uid?: string | undefined;
  message?: string | undefined;
}

/** Upload the local model with overwrite=true (lints first; refuses on errors). */
export async function push(config: Config, opts: PushOptions = {}): Promise<number> {
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const dashboard = await readModel(file);
  if (!dashboard) return 1;

  const errors = lintDashboard(dashboard).filter((i) => i.level === 'error');
  if (errors.length > 0) {
    console.error("Refusing to push: lint found errors. Run 'gredit lint' for details.");
    return 1;
  }

  let folderUid: string | undefined;
  try {
    const meta = (await Bun.file(metaFile(config, uid)).json()) as { folderUid?: string };
    folderUid = meta.folderUid;
  } catch {
    // no sidecar — dashboard will stay in its current folder on Grafana's side
  }

  const session = await openSession(config);
  try {
    const body: Record<string, unknown> = { dashboard, overwrite: true };
    if (folderUid) body.folderUid = folderUid;
    if (opts.message) body.message = opts.message;
    const res = await session.apiFetch<unknown>('/api/dashboards/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (looksUnauthenticated(res)) {
      console.error(REAUTH_HINT);
      return 2;
    }
    if (!res.ok) {
      console.error(`Push failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
      if (res.status === 403) {
        console.error(
          'A 403 may mean Grafana wants an extra header (CSRF / X-Grafana-Org-Id). ' +
            'Capture the headers your browser sends on a manual save and add them in session.ts.',
        );
      }
      return 1;
    }
    console.log(`Pushed ${uid}: ${JSON.stringify(res.body)}`);
    return 0;
  } finally {
    await session.close();
  }
}
