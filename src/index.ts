#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import {
  login,
  logout,
  pull,
  push,
  lint,
  shot,
  preview,
  setup,
  init,
  panelGet,
  panelSet,
  validate,
} from './commands/index.ts';
import { uidPositional, withConfig } from './runtime.ts';

const main = defineCommand({
  meta: {
    name: 'gredit',
    description: 'Agentic Grafana dashboard development (no API key needed)',
  },
  subCommands: {
    init: defineCommand({
      meta: { name: 'init', description: 'Create gredit.json interactively, then log in' },
      async run() {
        process.exit(await init());
      },
    }),
    setup: defineCommand({
      meta: {
        name: 'setup',
        description: 'Download the Playwright chromium browser (run once after install)',
      },
      async run() {
        process.exit(await setup());
      },
    }),
    login: defineCommand({
      meta: {
        name: 'login',
        description: 'Headful Okta login; saves the session to the profile dir',
      },
      async run() {
        process.exit(await withConfig((config) => login(config)));
      },
    }),
    logout: defineCommand({
      meta: { name: 'logout', description: 'Remove the stored session' },
      async run() {
        process.exit(await withConfig((config) => logout(config)));
      },
    }),
    pull: defineCommand({
      meta: {
        name: 'pull',
        description: 'Download the dashboard model to <dashboardsDir>/<uid>.json',
      },
      args: { uid: uidPositional },
      async run({ args }) {
        process.exit(await withConfig((config) => pull(config, args.uid)));
      },
    }),
    lint: defineCommand({
      meta: {
        name: 'lint',
        description: 'Validate the local model (no network). Nonzero exit on errors',
      },
      args: { uid: uidPositional },
      async run({ args }) {
        process.exit(await withConfig((config) => lint(config, args.uid)));
      },
    }),
    push: defineCommand({
      meta: { name: 'push', description: 'Lint, then upload the local model with overwrite=true' },
      args: {
        uid: uidPositional,
        message: {
          type: 'string' as const,
          description: 'Change note to attach to the dashboard version in Grafana',
          required: false,
        },
      },
      async run({ args }) {
        process.exit(
          await withConfig((config) => push(config, { uid: args.uid, message: args.message })),
        );
      },
    }),
    shot: defineCommand({
      meta: {
        name: 'shot',
        description: 'Screenshot the rendered dashboard to <dashboardsDir>/<uid>.png',
      },
      args: { uid: uidPositional },
      async run({ args }) {
        process.exit(await withConfig((config) => shot(config, args.uid)));
      },
    }),
    preview: defineCommand({
      meta: {
        name: 'preview',
        description: 'Open the dashboard in a browser for interactive preview',
      },
      args: { uid: uidPositional },
      async run({ args }) {
        process.exit(await withConfig((config) => preview(config, args.uid)));
      },
    }),
    validate: defineCommand({
      meta: {
        name: 'validate',
        description: 'Run panel queries against the live Grafana datasource and report pass/fail',
      },
      args: {
        uid: uidPositional,
        panel: {
          type: 'positional' as const,
          description: 'Panel title or #<id> (omit to validate all panels)',
          required: false,
        },
        var: {
          type: 'string' as const,
          description:
            'Override template vars: --var cluster=prod --var env=staging (values with commas must use separate --var flags)',
          required: false,
        },
        verbose: {
          type: 'boolean' as const,
          description: 'Print the substituted query expression alongside each result',
          required: false,
        },
        data: {
          type: 'boolean' as const,
          description:
            'Print a summary of the returned data (series labels, last value, point count)',
          required: false,
        },
        from: {
          type: 'string' as const,
          description: 'Query start time (default: now-1h). Grafana relative (now-6h) or epoch ms',
          required: false,
        },
        to: {
          type: 'string' as const,
          description: 'Query end time (default: now)',
          required: false,
        },
        raw: {
          type: 'boolean' as const,
          description:
            'Dump the raw Grafana API response JSON and exit; useful for debugging --data output',
          required: false,
        },
      },
      async run({ args }) {
        const varArgs = args.var ? (Array.isArray(args.var) ? args.var : [args.var]) : undefined;
        process.exit(
          await withConfig((config) =>
            validate(config, {
              uid: args.uid,
              selector: args.panel,
              vars: varArgs as string[] | undefined,
              verbose: args.verbose,
              data: args.data,
              from: args.from,
              to: args.to,
              raw: args.raw,
            }),
          ),
        );
      },
    }),
    panel: defineCommand({
      meta: {
        name: 'panel',
        description: 'Read or write a specific panel in the local dashboard model',
      },
      subCommands: {
        get: defineCommand({
          meta: {
            name: 'get',
            description:
              'Print panel JSON (or a specific field) to stdout; prints all matches if title is shared',
          },
          args: {
            uid: uidPositional,
            selector: {
              type: 'positional' as const,
              description: 'Panel title or #<id>',
              required: true,
            },
            path: {
              type: 'positional' as const,
              description: 'Field path, e.g. gridPos.h or targets[0].expression',
              required: false,
            },
          },
          async run({ args }) {
            process.exit(
              await withConfig((config) =>
                panelGet(config, { uid: args.uid, selector: args.selector, path: args.path }),
              ),
            );
          },
        }),
        set: defineCommand({
          meta: {
            name: 'set',
            description:
              'Set a panel field and write the local model back to disk; use #<id> if title is ambiguous',
          },
          args: {
            uid: uidPositional,
            selector: {
              type: 'positional' as const,
              description: 'Panel title or #<id>',
              required: true,
            },
            path: {
              type: 'positional' as const,
              description: 'Field path, e.g. gridPos.h or targets[0].expression',
              required: true,
            },
            value: {
              type: 'positional' as const,
              description: 'JSON-encoded or plain-string value',
              required: true,
            },
          },
          async run({ args }) {
            process.exit(
              await withConfig((config) =>
                panelSet(config, {
                  uid: args.uid,
                  selector: args.selector,
                  path: args.path,
                  value: args.value,
                }),
              ),
            );
          },
        }),
      },
    }),
  },
});

runMain(main);
