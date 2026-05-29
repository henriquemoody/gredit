import { resolve } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import type { Config } from "./config.ts";
import { resolveUid } from "./config.ts";
import { openSession, looksUnauthenticated } from "./session.ts";
import { lintDashboard, type DashboardModel } from "./lint.ts";

function dashFile(config: Config, uid: string): string {
  return resolve(process.cwd(), config.dashboardsDir, `${uid}.json`);
}

function metaFile(config: Config, uid: string): string {
  return resolve(process.cwd(), config.dashboardsDir, `${uid}.meta.json`);
}

const REAUTH_HINT = "Session looks unauthenticated — run 'grafana-dash login' to log in via Okta.";

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
    console.error("Refusing to push: lint found errors. Run 'grafana-dash lint' for details.");
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
