import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { openSession, looksUnauthenticated } from '../session.ts';
import { collectPanels, type DashboardModel, type Panel } from '../lint.ts';
import {
  parsePanelSelector,
  collectTemplateVars,
  parseVarOverrides,
  buildQueryPayload,
  extractQueryExpression,
  printFrameData,
  type DataFrame,
  type PanelValidationResult,
  type QueryResult,
} from '../validate.ts';
import { dashFile, readModel, REAUTH_HINT } from './paths.ts';
import { findPanels } from './panel.ts';

interface InternalPanelResult extends PanelValidationResult {
  rawBody?: unknown | undefined;
  httpStatus?: number | undefined;
}

interface ValidatePanelOptions {
  showData?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

interface DsQueryResponse {
  results?: Record<string, { status?: number; error?: string; frames?: DataFrame[] }>;
  message?: string; // top-level error (e.g. bad datasource uid)
}

async function validatePanel(
  session: Awaited<ReturnType<typeof openSession>>,
  panel: Panel,
  model: DashboardModel,
  vars: Map<string, string>,
  opts: ValidatePanelOptions = {},
): Promise<InternalPanelResult> {
  const base: Pick<PanelValidationResult, 'panelId' | 'panelTitle'> = {
    panelId: panel.id,
    panelTitle: panel.title,
  };

  const payload = buildQueryPayload(panel, model, vars, opts.from, opts.to);
  if (!payload) {
    return { ...base, results: [], skippedReason: 'no queryable targets' };
  }

  const res = await session.apiFetch<DsQueryResponse>('/api/ds/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Top-level failure (e.g. datasource not found, malformed request).
  // Note: apiFetch<T> can return a string body for non-JSON responses (e.g. HTML
  // redirect pages), so we widen to unknown before type-narrowing.
  const rawBody: unknown = res.body;
  if (typeof rawBody === 'string') {
    const msg = rawBody.slice(0, 200);
    return {
      ...base,
      results: payload.queries.map((q) => ({
        refId: q.refId,
        ok: false,
        noData: false,
        frames: 0,
        error: msg,
        expression: extractQueryExpression(q),
      })),
      rawBody: res.body,
      httpStatus: res.status,
    };
  }
  // Non-OK JSON with no results structure (e.g. datasource not found).
  const topLevelMsg = (rawBody as DsQueryResponse).message;
  if (!res.ok && topLevelMsg && !(rawBody as DsQueryResponse).results) {
    return {
      ...base,
      results: payload.queries.map((q) => ({
        refId: q.refId,
        ok: false,
        noData: false,
        frames: 0,
        error: topLevelMsg,
        expression: extractQueryExpression(q),
      })),
      rawBody: res.body,
      httpStatus: res.status,
    };
  }

  const body = rawBody as DsQueryResponse;
  const results: QueryResult[] = payload.queries.map((q) => {
    const r = body.results?.[q.refId];
    const expression = extractQueryExpression(q);
    if (!r)
      return {
        refId: q.refId,
        ok: false,
        noData: false,
        frames: 0,
        error: 'no result returned',
        expression,
      };
    const hasError = typeof r.error === 'string' && r.error.length > 0;
    const statusOk = (r.status ?? 200) < 400;
    const rawFrames = Array.isArray(r.frames) ? r.frames : [];
    const frameCount = rawFrames.length;
    const ok = !hasError && statusOk;
    return {
      refId: q.refId,
      ok,
      noData: ok && frameCount === 0,
      frames: frameCount,
      frameData: opts.showData && ok && frameCount > 0 ? rawFrames : undefined,
      error: hasError ? r.error : statusOk ? undefined : `HTTP ${r.status}`,
      expression,
    };
  });

  return { ...base, results, rawBody: res.body, httpStatus: res.status };
}

export interface ValidateOptions {
  uid?: string | undefined;
  selector?: string | undefined;
  vars?: string[] | undefined;
  verbose?: boolean | undefined;
  data?: boolean | undefined;
  from?: string | undefined;
  to?: string | undefined;
  raw?: boolean | undefined;
}

/** Run panel queries against the live Grafana instance and report pass/fail. */
export async function validate(config: Config, opts: ValidateOptions = {}): Promise<number> {
  const uid = resolveUid(config, opts.uid);
  const file = dashFile(config, uid);
  const model = await readModel(file);
  if (!model) return 1;

  const vars = collectTemplateVars(model);
  for (const [k, v] of parseVarOverrides(opts.vars)) vars.set(k, v);

  let panels = collectPanels(model.panels);

  if (opts.selector) {
    const matched = findPanels(model, opts.selector);
    if (matched.length === 0) {
      console.error(`No panel matching "${opts.selector}" in ${uid}`);
      return 1;
    }
    if (matched.length > 1) {
      console.error(
        `Ambiguous: ${matched.length} panels share the title "${opts.selector}". Use #<id> to target one:\n` +
          matched.map((p) => `  #${p.id}  "${p.title}"`).join('\n'),
      );
      return 1;
    }
    panels = matched;
  }

  if (opts.raw && panels.length !== 1) {
    console.error('--raw requires exactly one panel selector (e.g. "My Panel" or #42).');
    return 1;
  }

  if (opts.raw) {
    const target = panels[0]!;
    const hasQueryableTargets =
      Array.isArray((target as Record<string, unknown>).targets) &&
      ((target as Record<string, unknown>).targets as unknown[]).length > 0;
    if (!hasQueryableTargets) {
      const label = target.title ? `"${target.title}"` : `#${target.id}`;
      console.error(`Panel ${label} has no queryable targets — nothing to dump.`);
      return 1;
    }
  }

  const queryablePanels = panels.filter(
    (p) =>
      Array.isArray((p as Record<string, unknown>).targets) &&
      ((p as Record<string, unknown>).targets as unknown[]).length > 0,
  );

  if (queryablePanels.length === 0) {
    console.log('No panels with queries to validate.');
    return 0;
  }

  const session = await openSession(config);
  try {
    let totalQueries = 0;
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const panel of queryablePanels) {
      const label = panel.title ? `"${panel.title}" (#${panel.id})` : `#${panel.id}`;
      const pvr = await validatePanel(session, panel, model, vars, {
        showData: opts.data,
        from: opts.from,
        to: opts.to,
      });

      // Auth check must come before --raw to avoid dumping Okta HTML as data.
      if (
        pvr.rawBody !== undefined &&
        looksUnauthenticated({ status: pvr.httpStatus ?? 0, ok: false, body: pvr.rawBody })
      ) {
        console.error(REAUTH_HINT);
        return 2;
      }

      if (opts.raw) {
        process.stdout.write(JSON.stringify(pvr.rawBody, null, 2) + '\n');
        return 0;
      }

      if (pvr.skippedReason) {
        console.log(`  skip  ${label}: ${pvr.skippedReason}`);
        continue;
      }

      for (const r of pvr.results) {
        totalQueries++;
        if (!r.ok) {
          totalErrors++;
          console.error(`  error ${label}  [${r.refId}]: ${r.error ?? 'unknown error'}`);
          if (opts.verbose) console.error(`        query: ${r.expression}`);
        } else if (r.noData) {
          totalWarnings++;
          console.warn(`  warn  ${label}  [${r.refId}]: no data returned`);
          if (opts.verbose) console.warn(`        query: ${r.expression}`);
        } else {
          console.log(
            `  ok    ${label}  [${r.refId}]: ${r.frames} frame${r.frames === 1 ? '' : 's'}`,
          );
          if (opts.verbose) console.log(`        query: ${r.expression}`);
          if (r.frameData) printFrameData(r.frameData);
        }
      }
    }

    const parts: string[] = [];
    if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors === 1 ? '' : 's'}`);
    if (totalWarnings > 0)
      parts.push(`${totalWarnings} warning${totalWarnings === 1 ? '' : 's'} (no data)`);
    if (parts.length === 0) parts.push('all OK');
    console.log(
      `\n${queryablePanels.length} panel${queryablePanels.length === 1 ? '' : 's'}, ${totalQueries} quer${totalQueries === 1 ? 'y' : 'ies'}: ${parts.join(', ')}`,
    );
    return totalErrors > 0 ? 1 : 0;
  } finally {
    await session.close();
  }
}
