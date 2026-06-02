import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { parsePanelSelector } from '../validate.ts';
import { collectPanels } from '../lint.ts';
import type { Panel, DashboardModel } from '../lint.ts';
import { dashFile, readModel } from './paths.ts';

// --- Panel path helpers ---

export function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const re = /\[(\d+)\]|\.?([^.[]+)/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m.index !== lastEnd) {
      throw new Error(`Invalid path "${path}": unexpected character at position ${lastEnd}`);
    }
    if (m[1] !== undefined) parts.push(Number(m[1]));
    else if (m[2] !== undefined) parts.push(m[2]);
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd !== path.length) {
    throw new Error(`Invalid path "${path}": unexpected character at position ${lastEnd}`);
  }
  return parts;
}

export function getAtPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of parsePath(path)) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key as string | number];
  }
  return cur;
}

export function setAtPath(obj: unknown, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur !== 'object' || cur === null)
      throw new Error(`Cannot traverse "${path}": non-object at step ${i}`);
    cur = (cur as Record<string | number, unknown>)[parts[i] as string | number];
  }
  if (typeof cur !== 'object' || cur === null)
    throw new Error(`Cannot set "${path}": parent is not an object`);
  (cur as Record<string | number, unknown>)[parts[parts.length - 1] as string | number] = value;
}

export function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Find panels by a selector string (panel title or `#<id>`).
 * Returns all matches so callers can decide how to handle ambiguity.
 */
export function findPanels(model: DashboardModel, selector: string): Panel[] {
  const sel = parsePanelSelector(selector);
  const all = collectPanels(model.panels);
  if (sel.type === 'id') return all.filter((p: Panel) => p.id === sel.value);
  return all.filter((p: Panel) => p.title === sel.value);
}

export interface PanelGetOptions {
  uid?: string | undefined;
  selector?: string | undefined;
  path?: string | undefined;
}

/** Print a panel's JSON (or a specific field) to stdout. */
export async function panelGet(config: Config, opts: PanelGetOptions = {}): Promise<number> {
  if (!opts.selector) {
    console.error('Panel title or #id is required');
    return 1;
  }
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const model = await readModel(file);
  if (!model) return 1;
  const panels = findPanels(model, opts.selector);
  if (panels.length === 0) {
    console.error(`No panel matching "${opts.selector}" in ${uid}`);
    return 1;
  }
  for (const panel of panels) {
    if (panels.length > 1) {
      console.log(`--- panel #${panel.id} "${panel.title}" ---`);
    }
    const out = opts.path !== undefined ? getAtPath(panel, opts.path) : panel;
    process.stdout.write((out === undefined ? 'undefined' : JSON.stringify(out, null, 2)) + '\n');
  }
  return 0;
}

export interface PanelSetOptions {
  uid?: string | undefined;
  selector?: string | undefined;
  path?: string | undefined;
  value?: string | undefined;
}

/** Set a panel field in the local dashboard model and write it back to disk. */
export async function panelSet(config: Config, opts: PanelSetOptions = {}): Promise<number> {
  if (!opts.selector || !opts.path || opts.value === undefined) {
    console.error('panel selector, path, and value are all required');
    return 1;
  }
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const model = await readModel(file);
  if (!model) return 1;
  const panels = findPanels(model, opts.selector);
  if (panels.length === 0) {
    console.error(`No panel matching "${opts.selector}" in ${uid}`);
    return 1;
  }
  if (panels.length > 1) {
    console.error(
      `Ambiguous: ${panels.length} panels share the title "${opts.selector}". Use #<id> to target one:\n` +
        panels.map((p) => `  #${p.id}  "${p.title}"`).join('\n'),
    );
    return 1;
  }
  const panel = panels[0]!;
  const value = parseValue(opts.value);
  try {
    setAtPath(panel, opts.path, value);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  await Bun.write(file, JSON.stringify(model, null, 2) + '\n');
  console.log(
    `Set ${opts.path} = ${JSON.stringify(value)} on "${panel.title ?? opts.selector}" (#${panel.id})`,
  );
  return 0;
}
