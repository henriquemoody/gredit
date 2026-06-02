/**
 * List all panels in a dashboard with their id, title, type, and gridPos.
 */

import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { collectPanels, type DashboardModel } from '../lint.ts';
import { dashFile, readModel } from './paths.ts';

/**
 * A structured row representing panel information for display.
 */
export interface PanelRow {
  id: number | null;
  title: string | null;
  type: string | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
}

/**
 * Options for the panels command.
 */
export interface PanelsOptions {
  uid?: string | undefined;
  json?: boolean | undefined;
}

/**
 * Pure helper that extracts panel information from a dashboard model.
 * Flattens nested row panels using collectPanels.
 */
export function listPanels(model: DashboardModel): PanelRow[] {
  const panels = collectPanels(model.panels);
  const rows: PanelRow[] = [];

  for (const panel of panels) {
    rows.push({
      id: panel.id ?? null,
      title: panel.title ?? null,
      type: panel.type ?? null,
      x: panel.gridPos?.x ?? null,
      y: panel.gridPos?.y ?? null,
      w: panel.gridPos?.w ?? null,
      h: panel.gridPos?.h ?? null,
    });
  }

  return rows;
}

/**
 * List all panels in a dashboard with id, title, type, and gridPos (x, y, w, h).
 * Outputs as TSV by default, or JSON with --json flag.
 */
export async function panels(config: Config, opts: PanelsOptions = {}): Promise<number> {
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const model = await readModel(file);

  if (!model) {
    return 1;
  }

  const rows = listPanels(model);

  if (rows.length === 0) {
    console.log(`Dashboard ${uid} has no panels.`);
    return 0;
  }

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    // TSV output with header
    console.log('id\ttitle\ttype\tx\ty\tw\th');
    for (const row of rows) {
      console.log(
        `${row.id ?? '—'}\t${row.title ?? '—'}\t${row.type ?? '—'}\t${row.x ?? '—'}\t${row.y ?? '—'}\t${row.w ?? '—'}\t${row.h ?? '—'}`,
      );
    }
  }

  return 0;
}
