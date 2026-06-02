/** Show dashboard metadata: uid, title, version, panel count, max panel id, templating count. */

import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { collectPanels, type DashboardModel } from '../lint.ts';
import { dashFile, readModel } from './paths.ts';

/** Structured dashboard metadata. */
export interface DashboardInfo {
  uid: string | null;
  title: string | null;
  schemaVersion: number | null;
  panelCount: number;
  maxPanelId: number | null;
  templatingCount: number;
}

/** Options for the info command. */
export interface InfoOptions {
  uid?: string | undefined;
  json?: boolean | undefined;
}

/**
 * Compute dashboard metadata from the model.
 * Pure function with no I/O.
 */
export function dashboardInfo(model: DashboardModel): DashboardInfo {
  const panels = collectPanels(model.panels);
  const ids = panels.map((p) => p.id).filter((id): id is number => typeof id === 'number');

  return {
    uid: model.uid ?? null,
    title: model.title ?? null,
    schemaVersion: model.schemaVersion ?? null,
    panelCount: panels.length,
    maxPanelId: ids.length > 0 ? Math.max(...ids) : null,
    templatingCount: model.templating?.list?.length ?? 0,
  };
}

/**
 * Print dashboard metadata.
 * Outputs key=value pairs by default, JSON with --json flag.
 */
export async function info(config: Config, opts: InfoOptions = {}): Promise<number> {
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const model = await readModel(file);

  if (!model) {
    return 1;
  }

  const result = dashboardInfo(model);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const pad = 18;
    console.log(`${'uid:'.padEnd(pad)}${result.uid ?? '—'}`);
    console.log(`${'title:'.padEnd(pad)}${result.title ?? '—'}`);
    console.log(`${'schemaVersion:'.padEnd(pad)}${result.schemaVersion ?? '—'}`);
    console.log(`${'panelCount:'.padEnd(pad)}${result.panelCount}`);
    console.log(`${'maxPanelId:'.padEnd(pad)}${result.maxPanelId ?? '—'}`);
    console.log(`${'templatingCount:'.padEnd(pad)}${result.templatingCount}`);
  }

  return 0;
}
