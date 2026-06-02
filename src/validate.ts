/**
 * Helpers for the `gredit validate` command.
 * Pure functions only — no network, no file I/O.
 */

import type { DashboardModel, Panel } from './lint.ts';

// ---------------------------------------------------------------------------
// Template variable substitution
// ---------------------------------------------------------------------------

/** Sensible defaults for Grafana built-in variables used in validation runs. */
const GRAFANA_GLOBALS: Record<string, string> = {
  __interval: '1m',
  __interval_ms: '60000',
  __rate_interval: '5m',
  __rate_interval_ms: '300000',
  __range: '15m',
  __range_s: '900',
  __range_ms: '900000',
  __auto_interval: '1m',
  __from: 'now-15m',
  __to: 'now',
};

/**
 * Collect template variable default values from the dashboard model.
 * Includes Grafana built-in globals with sensible values for validation.
 */
export function collectTemplateVars(model: DashboardModel): Map<string, string> {
  const vars = new Map<string, string>(Object.entries(GRAFANA_GLOBALS));

  const list = model.templating?.list;
  if (!Array.isArray(list)) return vars;

  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    const name = v.name as string | undefined;
    if (!name) continue;

    const current = v.current as { value?: unknown } | undefined;
    if (!current) continue;

    const val = current.value;
    if (val === '$__all') {
      // "All" selected — use .* which works for most PromQL regex matchers
      vars.set(name, '.*');
    } else if (Array.isArray(val)) {
      vars.set(name, val.join('|'));
    } else if (val != null) {
      vars.set(name, String(val));
    }
  }

  return vars;
}

/**
 * Parse `k=v` pairs from the `--var` flags. Supports both:
 *  - Repeating `--var k=v --var k2=v2` (array form, recommended)
 *  - Legacy comma-separated `--var "k=v,k2=v2"` (values cannot contain commas)
 */
export function parseVarOverrides(raw: string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const entry of raw) {
    for (const pair of entry.split(',')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  return map;
}

/** Substitute Grafana template variable syntax in a single string. */
export function substituteVars(input: string, vars: Map<string, string>): string {
  // ${var:format} and ${var}
  input = input.replace(
    /\$\{([^}:]+)(?::[^}]*)?\}/g,
    (match, name: string) => vars.get(name) ?? match,
  );
  // [[var]]
  input = input.replace(/\[\[([^\]]+)\]\]/g, (match, name: string) => vars.get(name) ?? match);
  // $var — must come last to avoid double-substitution
  input = input.replace(
    /\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (match, name: string) => vars.get(name) ?? match,
  );
  return input;
}

/** Recursively substitute template vars in all string values of an object. */
export function substituteVarsInObject(obj: unknown, vars: Map<string, string>): unknown {
  if (typeof obj === 'string') return substituteVars(obj, vars);
  if (Array.isArray(obj)) return obj.map((item) => substituteVarsInObject(item, vars));
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = substituteVarsInObject(v, vars);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Query payload building
// ---------------------------------------------------------------------------

export interface QueryTarget {
  refId: string;
  datasource?: unknown | undefined;
  intervalMs?: number | undefined;
  maxDataPoints?: number | undefined;
  [key: string]: unknown;
}

export interface QueryPayload {
  queries: QueryTarget[];
  from: string;
  to: string;
}

/**
 * Build a `/api/ds/query` payload for a panel's targets.
 * Returns null when the panel has no queryable targets.
 */
export function buildQueryPayload(
  panel: Panel,
  model: DashboardModel,
  vars: Map<string, string>,
  from = 'now-1h',
  to = 'now',
): QueryPayload | null {
  const rawTargets = (panel as Record<string, unknown>).targets;
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) return null;

  // Resolve datasource priority: target > panel > null (Grafana uses the default)
  const panelDs = (panel as Record<string, unknown>).datasource ?? null;

  const queries: QueryTarget[] = [];
  for (const raw of rawTargets) {
    if (typeof raw !== 'object' || raw === null) continue;
    const t = raw as Record<string, unknown>;

    // Skip targets that are explicitly disabled
    if (t.hide === true) continue;

    const substituted = substituteVarsInObject({ ...t }, vars) as Record<string, unknown>;

    const query: QueryTarget = {
      intervalMs: 60000,
      maxDataPoints: 100,
      ...substituted,
      refId: typeof substituted.refId === 'string' ? substituted.refId : 'A',
    };

    // Fill datasource if the target doesn't carry one
    if (query.datasource == null || query.datasource === '') {
      query.datasource = panelDs ?? undefined;
    }

    queries.push(query);
  }

  if (queries.length === 0) return null;
  return { queries, from, to };
}

// ---------------------------------------------------------------------------
// Panel selector
// ---------------------------------------------------------------------------

export interface PanelSelector {
  type: 'title' | 'id';
  raw: string;
  value: string | number;
}

export function parsePanelSelector(selector: string): PanelSelector {
  if (selector.startsWith('#')) {
    const id = Number(selector.slice(1));
    if (!isNaN(id)) return { type: 'id', raw: selector, value: id };
  }
  return { type: 'title', raw: selector, value: selector };
}

// ---------------------------------------------------------------------------
// Data frame summarisation
// ---------------------------------------------------------------------------

export interface DataFrameField {
  name?: string | undefined;
  type?: string | undefined;
  labels?: Record<string, string> | undefined;
}

export interface DataFrame {
  schema?: { fields?: DataFrameField[] | undefined; name?: string | undefined } | undefined;
  data?: { values?: unknown[][] | undefined } | undefined;
}

function formatValue(val: unknown): unknown {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    if (!isFinite(val)) return String(val);
    return val; // keep as number so console.table right-aligns it
  }
  return val;
}

function formatLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .filter(([k]) => k !== '__name__')
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');
}

/**
 * Print data frames as a table using the built-in `console.table`.
 *
 * Three layouts:
 *  1. Time series  — one frame per series, field[0] is a time column;
 *                    rows keyed by series label, columns are value fields
 *  2. Grouped rows — one frame per group (e.g. CloudWatch Logs `stats … by`),
 *                    schema.name is the row key, each field has exactly 1 value
 *  3. Table        — one frame, fields are columns, values arrays are rows
 */
export function printFrameData(frames: DataFrame[]): void {
  if (frames.length === 0) return;

  const fields0 = frames[0]?.schema?.fields ?? [];

  // --- Time series ---
  const isTimeSeries =
    fields0.length >= 2 &&
    (fields0[0]?.type === 'time' || fields0[0]?.name?.toLowerCase() === 'time');

  if (isTimeSeries) {
    const tableObj: Record<string, Record<string, unknown>> = {};
    for (const frame of frames) {
      const fields = frame.schema?.fields ?? [];
      const values = frame.data?.values ?? [];
      const timeVals = (values[0] as number[] | undefined) ?? [];
      for (let fi = 1; fi < fields.length; fi++) {
        const field = fields[fi];
        const fieldVals = (values[fi] as unknown[] | undefined) ?? [];
        const key =
          field?.labels && Object.keys(field.labels).length > 0
            ? `{${formatLabels(field.labels)}}`
            : (field?.name ?? 'value');
        tableObj[key] = {
          lastValue: formatValue(fieldVals[fieldVals.length - 1]),
          points: timeVals.length,
        };
      }
    }
    console.table(tableObj);
    return;
  }

  // --- Grouped rows (one frame = one row, each field has at most 1 value) ---
  const isGrouped = frames.every((f) =>
    (f.data?.values ?? []).every((col) => (col as unknown[]).length <= 1),
  );

  if (isGrouped) {
    const colFields = frames[0]?.schema?.fields ?? [];
    const tableObj: Record<string, Record<string, unknown>> = {};
    for (const frame of frames) {
      const vals = frame.data?.values ?? [];
      const key = frame.schema?.name ?? '(unnamed)';
      const row: Record<string, unknown> = {};
      for (let fi = 0; fi < colFields.length; fi++) {
        const name = colFields[fi]?.name ?? `col${fi}`;
        row[name] = formatValue((vals[fi] as unknown[] | undefined)?.[0]);
      }
      tableObj[key] = row;
    }
    console.table(tableObj);
    return;
  }

  // --- Table (one frame, multiple rows) ---
  const frame = frames[0]!;
  const fields = frame.schema?.fields ?? [];
  const values = frame.data?.values ?? [];
  const rowCount = (values[0] as unknown[] | undefined)?.length ?? 0;
  const rows: Record<string, unknown>[] = [];
  for (let ri = 0; ri < rowCount; ri++) {
    const row: Record<string, unknown> = {};
    for (let fi = 0; fi < fields.length; fi++) {
      const name = fields[fi]?.name ?? `col${fi}`;
      row[name] = formatValue((values[fi] as unknown[] | undefined)?.[ri]);
    }
    rows.push(row);
  }
  console.table(rows);
}

// ---------------------------------------------------------------------------
// Result types (for commands.ts to use)
// ---------------------------------------------------------------------------

export interface QueryResult {
  refId: string;
  ok: boolean;
  noData: boolean;
  frames: number;
  /** Raw frames, populated when --data is passed; print with printFrameData(). */
  frameData?: DataFrame[] | undefined;
  error?: string | undefined;
  /** The substituted query expression, for --verbose output. */
  expression: string;
}

/**
 * Extract a human-readable query expression from a substituted target.
 * Tries well-known field names across common datasource types; falls back to
 * the full JSON of the target so something is always shown.
 */
export function extractQueryExpression(target: QueryTarget): string {
  for (const key of ['expr', 'rawSql', 'query', 'target', 'expression', 'sql']) {
    const val = target[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  // Strip internal Grafana fields before JSON-dumping so the output is readable
  const {
    refId: _r,
    datasource: _d,
    intervalMs: _i,
    maxDataPoints: _m,
    hide: _h,
    ...rest
  } = target;
  return JSON.stringify(rest);
}

export interface PanelValidationResult {
  panelId: number | undefined;
  panelTitle: string | undefined;
  results: QueryResult[];
  skippedReason?: string | undefined;
}
