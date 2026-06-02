/**
 * Inspect template variables from a dashboard's templating.list block.
 */

import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import type { DashboardModel } from '../lint.ts';
import { dashFile, readModel } from './paths.ts';

/**
 * A structured row representing a template variable.
 */
export interface VarRow {
  name: string;
  type: string | null;
  current: string | null;
  optionsCount: number;
}

/**
 * Extract template variables from a dashboard model.
 * Pure function with no I/O.
 */
export function listVars(model: DashboardModel): VarRow[] {
  const rows: VarRow[] = [];
  const list = model.templating?.list;

  if (!Array.isArray(list)) {
    return [];
  }

  for (const item of list) {
    // Type narrowing from unknown
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const v = item as Record<string, unknown>;
    const name = v.name;
    if (typeof name !== 'string') {
      continue;
    }

    // Extract type (may be null or undefined)
    let type: string | null = null;
    const typeValue = v.type;
    if (typeof typeValue === 'string') {
      type = typeValue;
    }

    // Extract current value
    let current: string | null = null;
    const currentObj = v.current;
    if (typeof currentObj === 'object' && currentObj !== null) {
      const currentValue = (currentObj as Record<string, unknown>).value;
      if (currentValue === '$__all') {
        current = '.*';
      } else if (Array.isArray(currentValue)) {
        current = currentValue.map(String).join(',');
      } else if (currentValue != null) {
        current = String(currentValue);
      }
    }

    // Count options
    let optionsCount = 0;
    const options = v.options;
    if (Array.isArray(options)) {
      optionsCount = options.length;
    }

    rows.push({
      name,
      type,
      current,
      optionsCount,
    });
  }

  return rows;
}

/** Options for the vars command. */
export interface VarsOptions {
  uid?: string | undefined;
  json?: boolean | undefined;
}

/**
 * Print template variables from a dashboard.
 * Outputs TSV by default, JSON with --json flag.
 */
export async function vars(config: Config, opts: VarsOptions = {}): Promise<number> {
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const model = await readModel(file);

  if (!model) {
    return 1;
  }

  const rows = listVars(model);

  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    // TSV output with header
    console.log('name\ttype\tcurrent\toptions');
    for (const row of rows) {
      const type = row.type ?? 'null';
      const current = row.current ?? 'null';
      console.log(`${row.name}\t${type}\t${current}\t${row.optionsCount}`);
    }
  }

  return 0;
}
