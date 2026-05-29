#!/usr/bin/env bun
import { loadConfig, ConfigError } from "./config.ts";
import { login, logout, pull, push, lint, shot, preview } from "./commands.ts";

const HELP = `grafana-dash — agentic Grafana dashboard development (no API key needed)

Usage:
  grafana-dash <command> [uid|alias]

Commands:
  login                Headful Okta login; saves the session to the profile dir.
  logout               Remove the stored session.
  pull  [uid|alias]    Download the dashboard model to <dashboardsDir>/<uid>.json.
  lint  [uid|alias]    Validate the local model (no network). Nonzero exit on errors.
  push  [uid|alias]    Lint, then upload the local model with overwrite=true.
  shot    [uid|alias]  Screenshot the rendered dashboard to <dashboardsDir>/<uid>.png.
  preview [uid|alias]  Open the dashboard in a browser for interactive preview.
  help                 Show this message.

Config (grafana-dash.config.json in the current directory):
  {
    "baseUrl": "https://grafana.company.com",   // required
    "profileDir": ".gf-profile",                 // session cookies live here
    "dashboardsDir": "dashboards",
    "uid": "abc123",                             // default uid (optional)
    "dashboards": { "main": "abc123" },          // alias -> uid (optional)
    "shotKiosk": true,
    "headless": false
  }

Env overrides: GRAFANA_BASE_URL, GRAFANA_PROFILE_DIR, GRAFANA_DASHBOARDS_DIR,
GRAFANA_UID, GRAFANA_HEADLESS=1

Typical loop:
  grafana-dash login         # once, until the Okta session expires
  grafana-dash pull main     # then edit dashboards/<uid>.json
  grafana-dash lint main
  grafana-dash push main
  grafana-dash shot main     # screenshot the rendered result
  grafana-dash preview main  # open in browser for interactive review
`;

async function main(): Promise<number> {
  const [cmd, arg] = process.argv.slice(2);

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    return cmd ? 0 : 1;
  }

  const known = ["login", "logout", "pull", "push", "lint", "shot", "preview"] as const;
  if (!known.includes(cmd as (typeof known)[number])) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    return 1;
  }

  const config = await loadConfig();
  switch (cmd) {
    case "login":
      return login(config);
    case "logout":
      return logout(config);
    case "pull":
      return pull(config, arg);
    case "lint":
      return lint(config, arg);
    case "push":
      return push(config, arg);
    case "shot":
      return shot(config, arg);
    case "preview":
      return preview(config, arg);
    default:
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
    } else {
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    }
    process.exit(1);
  });
