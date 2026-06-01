import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Config } from "./config.ts";
import { resolveUid, loadConfig, configPath } from "./config.ts";
import { openSession, looksUnauthenticated } from "./session.ts";
import { lintDashboard, collectPanels, type DashboardModel, type Panel } from "./lint.ts";

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
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function setAtPath(obj: unknown, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur !== "object" || cur === null)
      throw new Error(`Cannot traverse "${path}": non-object at step ${i}`);
    cur = (cur as Record<string | number, unknown>)[parts[i]];
  }
  if (typeof cur !== "object" || cur === null)
    throw new Error(`Cannot set "${path}": parent is not an object`);
  (cur as Record<string | number, unknown>)[parts[parts.length - 1]] = value;
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function findPanel(model: DashboardModel, title: string, uid: string): Panel | undefined {
  const panel = collectPanels(model.panels).find((p) => p.title === title);
  if (!panel) console.error(`No panel titled "${title}" in ${uid}`);
  return panel;
}

/** Print a panel's JSON (or a specific field) to stdout. */
export async function panelGet(config: Config, arg?: string, title?: string, path?: string): Promise<number> {
  if (!title) { console.error("Panel title is required"); return 1; }
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  let model: DashboardModel;
  try {
    model = (await Bun.file(file).json()) as DashboardModel;
  } catch (err) {
    console.error(`Could not read ${file}: ${(err as Error).message}`);
    return 1;
  }
  const panel = findPanel(model, title, uid);
  if (!panel) return 1;
  const out = path !== undefined ? getAtPath(panel, path) : panel;
  process.stdout.write((out === undefined ? "undefined" : JSON.stringify(out, null, 2)) + "\n");
  return 0;
}

/** Set a panel field in the local dashboard model and write it back to disk. */
export async function panelSet(config: Config, arg?: string, title?: string, path?: string, rawValue?: string): Promise<number> {
  if (!title || !path || rawValue === undefined) {
    console.error("title, path, and value are all required");
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
  const panel = findPanel(model, title, uid);
  if (!panel) return 1;
  const value = parseValue(rawValue);
  try {
    setAtPath(panel, path, value);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  await Bun.write(file, JSON.stringify(model, null, 2) + "\n");
  console.log(`Set ${path} = ${JSON.stringify(value)} on "${title}"`);
  return 0;
}

/** Screenshot the rendered dashboard to dashboardsDir/<uid>.png. */
export async function shot(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const session = await openSession(config);
  try {
    const url = `${config.baseUrl}/d/${uid}${config.shotKiosk ? "?kiosk" : ""}`;
    await session.page.goto(url, { waitUntil: "networkidle" });
    await session.page.waitForTimeout(3000); // let panels finish querying
    await mkdir(resolve(process.cwd(), config.dashboardsDir), { recursive: true });
    const out = dashFile(config, uid).replace(/\.json$/, "") + ".png";
    await session.page.screenshot({ path: out, fullPage: true });
    console.log(`Saved screenshot -> ${out}`);
    return 0;
  } finally {
    await session.close();
  }
}
