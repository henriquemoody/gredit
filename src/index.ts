#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { loadConfig, ConfigError } from "./config.ts";
import { login, logout, pull, push, lint, shot, preview, setup, init, panelGet, panelSet } from "./commands.ts";

const uid = {
  type: "positional" as const,
  description: "Dashboard UID or alias",
  required: false,
};

async function withConfig<T>(fn: (config: Awaited<ReturnType<typeof loadConfig>>) => Promise<T>): Promise<T> {
  try {
    const config = await loadConfig();
    return await fn(config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

const main = defineCommand({
  meta: {
    name: "gredit",
    description: "Agentic Grafana dashboard development (no API key needed)",
  },
  subCommands: {
    init: defineCommand({
      meta: { name: "init", description: "Create gredit.json interactively, then log in" },
      async run() {
        process.exit(await init());
      },
    }),
    setup: defineCommand({
      meta: { name: "setup", description: "Download the Playwright chromium browser (run once after install)" },
      async run() {
        process.exit(await setup());
      },
    }),
    login: defineCommand({
      meta: { name: "login", description: "Headful Okta login; saves the session to the profile dir" },
      async run() {
        process.exit(await withConfig((config) => login(config)));
      },
    }),
    logout: defineCommand({
      meta: { name: "logout", description: "Remove the stored session" },
      async run() {
        process.exit(await withConfig((config) => logout(config)));
      },
    }),
    pull: defineCommand({
      meta: { name: "pull", description: "Download the dashboard model to <dashboardsDir>/<uid>.json" },
      args: { uid },
      async run({ args }) {
        process.exit(await withConfig((config) => pull(config, args.uid)));
      },
    }),
    lint: defineCommand({
      meta: { name: "lint", description: "Validate the local model (no network). Nonzero exit on errors" },
      args: { uid },
      async run({ args }) {
        process.exit(await withConfig((config) => lint(config, args.uid)));
      },
    }),
    push: defineCommand({
      meta: { name: "push", description: "Lint, then upload the local model with overwrite=true" },
      args: { uid },
      async run({ args }) {
        process.exit(await withConfig((config) => push(config, args.uid)));
      },
    }),
    shot: defineCommand({
      meta: { name: "shot", description: "Screenshot the rendered dashboard to <dashboardsDir>/<uid>.png" },
      args: { uid },
      async run({ args }) {
        process.exit(await withConfig((config) => shot(config, args.uid)));
      },
    }),
    preview: defineCommand({
      meta: { name: "preview", description: "Open the dashboard in a browser for interactive preview" },
      args: { uid },
      async run({ args }) {
        process.exit(await withConfig((config) => preview(config, args.uid)));
      },
    }),
    panel: defineCommand({
      meta: { name: "panel", description: "Read or write a specific panel in the local dashboard model" },
      subCommands: {
        get: defineCommand({
          meta: { name: "get", description: "Print panel JSON (or a specific field) to stdout" },
          args: {
            uid: { type: "positional" as const, description: "Dashboard UID or alias", required: false },
            title: { type: "positional" as const, description: "Panel title", required: true },
            path: { type: "positional" as const, description: "Field path, e.g. gridPos.h or targets[0].expression", required: false },
          },
          async run({ args }) {
            process.exit(await withConfig((config) => panelGet(config, args.uid, args.title, args.path)));
          },
        }),
        set: defineCommand({
          meta: { name: "set", description: "Set a panel field and write the local model back to disk" },
          args: {
            uid: { type: "positional" as const, description: "Dashboard UID or alias", required: false },
            title: { type: "positional" as const, description: "Panel title", required: true },
            path: { type: "positional" as const, description: "Field path, e.g. gridPos.h or targets[0].expression", required: true },
            value: { type: "positional" as const, description: "JSON-encoded or plain-string value", required: true },
          },
          async run({ args }) {
            process.exit(await withConfig((config) => panelSet(config, args.uid, args.title, args.path, args.value)));
          },
        }),
      },
    }),
  },
});

runMain(main);
