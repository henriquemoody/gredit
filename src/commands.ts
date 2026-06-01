import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Config } from "./config.ts";
import { resolveUid, loadConfig, configPath } from "./config.ts";
import { openSession, looksUnauthenticated } from "./session.ts";
import { lintDashboard, collectPanels, type DashboardModel, type Panel } from "./lint.ts";
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
} from "./validate.ts";

/** Download the Playwright chromium browser required by all browser commands. */
export async function setup(): Promise<number> {
  console.log("Downloading Playwright chromium browser...");
  // playwright-core bundles the registry and download logic; this is the same
  // function called by the playwright npm postinstall script.
  // @ts-expect-error — not in playwright-core's public exports map
  const { registry } = (await import("playwright-core/lib/coreBundle")) as {
    registry: { installBrowsersForNpmInstall(browsers: string[]): Promise<void> };
  };
  await registry.installBrowsersForNpmInstall(["chromium"]);
  console.log("Done.");
  return 0;
}

/** Interactive wizard that creates gredit.json, then runs login. */
export async function init(): Promise<number> {
  const cfgFile = configPath();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));

  try {
    if (existsSync(cfgFile)) {
      const ans = await ask("gredit.json already exists. Overwrite? [y/N] ");
      if (!ans.toLowerCase().startsWith("y")) {
        console.log("Aborted.");
        return 0;
      }
    }

    console.log("\nSet up gredit — press Enter to accept defaults.\n");

    let baseUrl = "";
    while (!baseUrl) {
      baseUrl = await ask("Grafana base URL (e.g. https://grafana.company.com): ");
      if (!baseUrl) console.error("  baseUrl is required.");
    }
    baseUrl = baseUrl.replace(/\/+$/, "");

    const profileDir = (await ask("Session profile directory [.gredit-profile]: ")) || ".gredit-profile";
    const dashboardsDir = (await ask("Dashboards directory [dashboards]: ")) || "dashboards";
    const uid = await ask("Default dashboard UID (optional, press Enter to skip): ");

    const shotKioskAns = (await ask("Screenshot in kiosk mode? [Y/n] ")) || "y";
    const shotKiosk = shotKioskAns.toLowerCase().startsWith("y");

    const cfg: Record<string, unknown> = { baseUrl, profileDir, dashboardsDir, shotKiosk, headless: false };
    if (uid) cfg.uid = uid;

    await Bun.write(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`\nCreated gredit.json.`);
  } finally {
    rl.close();
  }

  console.log("Starting login...\n");
  return login(await loadConfig());
}

function dashFile(config: Config, uid: string): string {
  return resolve(process.cwd(), config.dashboardsDir, `${uid}.json`);
}

function metaFile(config: Config, uid: string): string {
  return resolve(process.cwd(), config.dashboardsDir, `${uid}.meta.json`);
}

const REAUTH_HINT = "Session looks unauthenticated — run 'gredit login' to log in via Okta.";

/** One-time, headful Okta login. Holds the browser open until the user is done. */
export async function login(config: Config): Promise<number> {
  if (config.headless) {
    console.warn("Note: headless is enabled; Okta login usually needs a visible window.");
  }
  const session = await openSession(config);
  console.log(`Opened ${config.baseUrl}.`);
  console.log("Complete the Okta login in the browser window, then press Enter here to save the session.");
  await new Promise<void>((res) => process.stdin.once("data", () => res()));
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

/** Download a dashboard model and write it to dashboardsDir/<uid>.json. */
export async function pull(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const session = await openSession(config);
  try {
    const res = await session.apiFetch<{ dashboard: DashboardModel; meta?: Record<string, unknown> }>(`/api/dashboards/uid/${uid}`);
    if (looksUnauthenticated(res)) {
      console.error(REAUTH_HINT);
      return 2;
    }
    if (!res.ok) {
      console.error(`Pull failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
      return 1;
    }
    const { dashboard, meta } = res.body;
    await mkdir(resolve(process.cwd(), config.dashboardsDir), { recursive: true });
    const out = dashFile(config, uid);
    await Bun.write(out, JSON.stringify(dashboard, null, 2) + "\n");
    if (meta?.folderUid) {
      await Bun.write(metaFile(config, uid), JSON.stringify({ folderUid: meta.folderUid }, null, 2) + "\n");
    }
    console.log(`Pulled ${uid} -> ${config.dashboardsDir}/${uid}.json`);
    return 0;
  } finally {
    await session.close();
  }
}

/** Validate the local model; returns nonzero if there are errors. */
export async function lint(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  let model: DashboardModel;
  try {
    model = (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return 1;
  }
  const issues = lintDashboard(model);
  const errors = issues.filter((i) => i.level === "error");
  for (const i of issues) {
    console.log(`${i.level === "error" ? "ERROR" : "warn "}  ${i.message}`);
  }
  if (issues.length === 0) console.log("OK — no issues.");
  return errors.length > 0 ? 1 : 0;
}

/** Upload the local model with overwrite=true (lints first; refuses on errors). */
export async function push(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  let dashboard: DashboardModel;
  try {
    dashboard = (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return 1;
  }

  const errors = lintDashboard(dashboard).filter((i) => i.level === "error");
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
    const res = await session.apiFetch<unknown>("/api/dashboards/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
          "A 403 may mean Grafana wants an extra header (CSRF / X-Grafana-Org-Id). " +
            "Capture the headers your browser sends on a manual save and add them in session.ts.",
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

/** Open the dashboard in the browser for interactive preview. */
export async function preview(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const url = `${config.baseUrl}/d/${uid}`;
  const session = await openSession({ ...config, headless: false });
  try {
    await session.page.goto(url, { waitUntil: "domcontentloaded" });
    console.log(`Previewing ${url}`);
    console.log("Press Enter to close the browser.");
    await new Promise<void>((res) => process.stdin.once("data", () => res()));
    return 0;
  } finally {
    await session.close();
  }
}

// --- Panel path helpers ---

function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const re = /\[(\d+)\]|\.?([^.[]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) parts.push(Number(m[1]));
    else if (m[2] !== undefined) parts.push(m[2]);
  }
  return parts;
}

function getAtPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of parsePath(path)) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key as string | number];
  }
  return cur;
}

function setAtPath(obj: unknown, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur !== "object" || cur === null)
      throw new Error(`Cannot traverse "${path}": non-object at step ${i}`);
    cur = (cur as Record<string | number, unknown>)[parts[i] as string | number];
  }
  if (typeof cur !== "object" || cur === null)
    throw new Error(`Cannot set "${path}": parent is not an object`);
  (cur as Record<string | number, unknown>)[parts[parts.length - 1] as string | number] = value;
}

function parseValue(raw: string): unknown {
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
function findPanels(model: DashboardModel, selector: string): Panel[] {
  const sel = parsePanelSelector(selector);
  const all = collectPanels(model.panels);
  if (sel.type === "id") return all.filter((p) => p.id === sel.value);
  return all.filter((p) => p.title === sel.value);
}

/** Print a panel's JSON (or a specific field) to stdout. */
export async function panelGet(config: Config, arg?: string, selector?: string, path?: string): Promise<number> {
  if (!selector) { console.error("Panel title or #id is required"); return 1; }
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  let model: DashboardModel;
  try {
    model = (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return 1;
  }
  const panels = findPanels(model, selector);
  if (panels.length === 0) {
    console.error(`No panel matching "${selector}" in ${uid}`);
    return 1;
  }
  for (const panel of panels) {
    if (panels.length > 1) {
      console.log(`--- panel #${panel.id} "${panel.title}" ---`);
    }
    const out = path !== undefined ? getAtPath(panel, path) : panel;
    process.stdout.write((out === undefined ? "undefined" : JSON.stringify(out, null, 2)) + "\n");
  }
  return 0;
}

/** Set a panel field in the local dashboard model and write it back to disk. */
export async function panelSet(config: Config, arg?: string, selector?: string, path?: string, rawValue?: string): Promise<number> {
  if (!selector || !path || rawValue === undefined) {
    console.error("panel selector, path, and value are all required");
    return 1;
  }
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  let model: DashboardModel;
  try {
    model = (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return 1;
  }
  const panels = findPanels(model, selector);
  if (panels.length === 0) {
    console.error(`No panel matching "${selector}" in ${uid}`);
    return 1;
  }
  if (panels.length > 1) {
    console.error(
      `Ambiguous: ${panels.length} panels share the title "${selector}". Use #<id> to target one:\n` +
        panels.map((p) => `  #${p.id}  "${p.title}"`).join("\n"),
    );
    return 1;
  }
  const panel = panels[0]!;
  const value = parseValue(rawValue);
  try {
    setAtPath(panel, path, value);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  await Bun.write(file, JSON.stringify(model, null, 2) + "\n");
  console.log(`Set ${path} = ${JSON.stringify(value)} on "${panel.title ?? selector}" (#${panel.id})`);
  return 0;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

interface DsQueryResponse {
  results?: Record<
    string,
    { status?: number; error?: string; frames?: DataFrame[] }
  >;
  message?: string; // top-level error (e.g. bad datasource uid)
}

async function validatePanel(
  session: Awaited<ReturnType<typeof openSession>>,
  panel: Panel,
  model: DashboardModel,
  vars: Map<string, string>,
  showData = false,
  from?: string,
  to?: string,
  raw = false,
): Promise<PanelValidationResult> {
  const base: Pick<PanelValidationResult, "panelId" | "panelTitle"> = {
    panelId: panel.id,
    panelTitle: panel.title,
  };

  const payload = buildQueryPayload(panel, model, vars, from, to);
  if (!payload) {
    return { ...base, results: [], skippedReason: "no queryable targets" };
  }

  const res = await session.apiFetch<DsQueryResponse>("/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (raw) {
    process.stdout.write(JSON.stringify(res.body, null, 2) + "\n");
    process.exit(0);
  }

  // Top-level failure (e.g. datasource not found, malformed request).
  // Note: apiFetch<T> can return a string body for non-JSON responses (e.g. HTML
  // redirect pages), so we widen to unknown before type-narrowing.
  const rawBody: unknown = res.body;
  if (typeof rawBody === "string") {
    const msg = rawBody.slice(0, 200);
    return {
      ...base,
      results: payload.queries.map((q) => ({
        refId: q.refId, ok: false, noData: false, frames: 0,
        error: msg, expression: extractQueryExpression(q),
      })),
    };
  }
  // Non-OK JSON with no results structure (e.g. datasource not found).
  const topLevelMsg = (rawBody as DsQueryResponse).message;
  if (!res.ok && topLevelMsg && !(rawBody as DsQueryResponse).results) {
    return {
      ...base,
      results: payload.queries.map((q) => ({
        refId: q.refId, ok: false, noData: false, frames: 0,
        error: topLevelMsg, expression: extractQueryExpression(q),
      })),
    };
  }

  const body = rawBody as DsQueryResponse;
  const results: QueryResult[] = payload.queries.map((q) => {
    const r = body.results?.[q.refId];
    const expression = extractQueryExpression(q);
    if (!r) return { refId: q.refId, ok: false, noData: false, frames: 0, error: "no result returned", expression };
    const hasError = typeof r.error === "string" && r.error.length > 0;
    const statusOk = (r.status ?? 200) < 400;
    const rawFrames = Array.isArray(r.frames) ? r.frames : [];
    const frameCount = rawFrames.length;
    const ok = !hasError && statusOk;
    return {
      refId: q.refId,
      ok,
      noData: ok && frameCount === 0,
      frames: frameCount,
      frameData: showData && ok && frameCount > 0 ? rawFrames : undefined,
      error: hasError ? r.error : statusOk ? undefined : `HTTP ${r.status}`,
      expression,
    };
  });

  return { ...base, results };
}

/** Run panel queries against the live Grafana instance and report pass/fail. */
export async function validate(
  config: Config,
  arg?: string,
  selectorArg?: string,
  varsArg?: string,
  verbose = false,
  showData = false,
  from?: string,
  to?: string,
  raw = false,
): Promise<number> {
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  let model: DashboardModel;
  try {
    model = (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return 1;
  }

  const vars = collectTemplateVars(model);
  for (const [k, v] of parseVarOverrides(varsArg)) vars.set(k, v);

  let panels = collectPanels(model.panels);

  if (selectorArg) {
    const matched = findPanels(model, selectorArg);
    if (matched.length === 0) {
      console.error(`No panel matching "${selectorArg}" in ${uid}`);
      return 1;
    }
    if (matched.length > 1) {
      console.error(
        `Ambiguous: ${matched.length} panels share the title "${selectorArg}". Use #<id> to target one:\n` +
          matched.map((p) => `  #${p.id}  "${p.title}"`).join("\n"),
      );
      return 1;
    }
    panels = matched;
  }

  const queryablePanels = panels.filter(
    (p) => Array.isArray((p as Record<string, unknown>).targets) && ((p as Record<string, unknown>).targets as unknown[]).length > 0,
  );

  if (queryablePanels.length === 0) {
    console.log("No panels with queries to validate.");
    return 0;
  }

  const session = await openSession(config);
  try {
    let totalQueries = 0;
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const panel of queryablePanels) {
      const label = panel.title ? `"${panel.title}" (#${panel.id})` : `#${panel.id}`;
      const pvr = await validatePanel(session, panel, model, vars, showData, from, to, raw);

      // Check for session expiry on the first response that looks like a redirect.
      if (
        pvr.results.length > 0 &&
        pvr.results[0]?.error &&
        looksUnauthenticated({ status: 0, ok: false, body: pvr.results[0].error })
      ) {
        console.error(REAUTH_HINT);
        return 2;
      }

      if (pvr.skippedReason) {
        console.log(`  skip  ${label}: ${pvr.skippedReason}`);
        continue;
      }

      for (const r of pvr.results) {
        totalQueries++;
        if (!r.ok) {
          totalErrors++;
          console.error(`  error ${label}  [${r.refId}]: ${r.error ?? "unknown error"}`);
          if (verbose) console.error(`        query: ${r.expression}`);
        } else if (r.noData) {
          totalWarnings++;
          console.warn(`  warn  ${label}  [${r.refId}]: no data returned`);
          if (verbose) console.warn(`        query: ${r.expression}`);
        } else {
          console.log(`  ok    ${label}  [${r.refId}]: ${r.frames} frame${r.frames === 1 ? "" : "s"}`);
          if (verbose) console.log(`        query: ${r.expression}`);
          if (r.frameData) printFrameData(r.frameData);
        }
      }
    }

    const parts: string[] = [];
    if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors === 1 ? "" : "s"}`);
    if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings === 1 ? "" : "s"} (no data)`);
    if (parts.length === 0) parts.push("all OK");
    console.log(`\n${queryablePanels.length} panel${queryablePanels.length === 1 ? "" : "s"}, ${totalQueries} quer${totalQueries === 1 ? "y" : "ies"}: ${parts.join(", ")}`);
    return totalErrors > 0 ? 1 : 0;
  } finally {
    await session.close();
  }
}

/** Screenshot the rendered dashboard to dashboardsDir/<uid>.png. */
export async function shot(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const session = await openSession(config);
  try {
    const url = `${config.baseUrl}/d/${uid}${config.shotKiosk ? "?kiosk" : ""}`;
    await session.page.goto(url, { waitUntil: "networkidle" });
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

    await mkdir(resolve(process.cwd(), config.dashboardsDir), { recursive: true });
    const out = dashFile(config, uid).replace(/\.json$/, "") + ".png";
    await session.page.screenshot({ path: out, fullPage: true });
    console.log(`Saved screenshot -> ${out}`);
    return 0;
  } finally {
    await session.close();
  }
}
