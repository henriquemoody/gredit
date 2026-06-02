# Agent guidelines

Conventions for anyone (human or agent) modifying this repo. Derived from the patterns the codebase has been refactored into — follow them when adding or changing code.

## Architecture

- **One concern per file.** Commands live in `src/commands/<name>.ts`. The shared barrel (`src/commands/index.ts`) re-exports only the command entry functions plus their public option types — never internal helpers like `parsePath`, `findPanels`, or `readModel`.
- **Keep pure modules pure.** `src/lint.ts` and `src/validate.ts` must not import from `./commands/*`, must not do I/O, and must not carry types that exist only for the command layer. If a result type grows command-layer fields (e.g. `rawBody`, `httpStatus`), define an extending interface inside the command file instead.
- **The CLI entry (`src/index.ts`) is wiring only.** It defines citty commands and forwards parsed args. Business logic, error formatting, and config loading belong in `src/commands/*` and `src/runtime.ts`.
- **`src/runtime.ts`** owns cross-cutting CLI infrastructure (`withConfig`, shared positional defs). Add new shared CLI plumbing here, not in `index.ts`.
- **`src/commands/paths.ts`** owns dashboard-file paths, `readModel`, and shared constants like `REAUTH_HINT`. Add new file-path helpers here.

## Function signatures

- **No `process.exit` in leaf functions.** Only command entry points (and `withConfig`) terminate the process. Helpers return numeric exit codes or typed results; the caller decides what to do.
- **Use an options object once you have more than ~3 args** or more than one optional flag. Example: `validate(config, opts)` with `opts: ValidateOptions` rather than 8 positionals. The citty handler already gives you an `args` object — pass it through.
- **Public option types are exported as `export type`** from the command file and re-exported from the barrel with `export type { ... }`.

## TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames` are all enabled. Don't disable them to silence an error — fix the type.
- **No `any`.** Use `unknown` and narrow, or a typed `Partial<Record<...>>` over a typed key set.
- **Error subclasses set `override name`.** See `ConfigError` in `src/config.ts`.
- **Throw on bad user input, don't silently accept it.** `parsePath` validates that the regex consumed the entire input and throws on garbage — match that pattern when parsing CLI-supplied strings.

## Testing

- **Pure modules have tests.** `lint.ts`, `validate.ts`, and command-file pure helpers (`panel.ts`) have `*.test.ts` companions using `bun:test`. New pure helpers should ship with tests.
- **Tests live next to the source** (`src/lint.test.ts` next to `src/lint.ts`). Don't introduce a separate `tests/` tree.
- **Test names describe actual behavior, not aspiration.** If a function has a known limitation (e.g. `parseVarOverrides` splits on commas), name the test for what it does ("splits on commas even within a single value"), not what you wish it did.
- **`bun test` must pass before every commit.** Same for `bun run typecheck` and `bun run format:check`.

## CI and publish gates

- **`prepublishOnly`** must run typecheck **and** tests. A green publish should mean a green test suite.
- **CI runs** typecheck, tests, and `format:check`. Don't ship a workflow that runs only one of them.
- **Run `bun run format` before committing.** Prettier (`printWidth: 100`, `singleQuote: true`, `trailingComma: all`) is enforced by CI — broken formatting blocks merge.

## Bun and Node specifics

- **Static imports for `node:*` stdlib modules.** Dynamic `await import('node:path')` saves nothing and creates inconsistency.
- **Lazy-import heavy or optional deps.** Playwright is `await import('playwright')` inside `openSession` so browser-free commands don't pay for it and don't require the browser binaries. Apply the same pattern when adding a heavyweight dep that not all commands need.
- **Use `Bun.file()` / `Bun.write()`** for reading and writing JSON. Reach for `node:fs/promises` only for operations Bun's API doesn't cover (`mkdir`, `rm`).

## Session and API

- **`apiFetch` runs inside the browser page context.** That's how the Grafana session cookie and the correct `Origin` header attach for CSRF. Don't switch to a top-level `fetch` without solving both.
- **`init` passed to `apiFetch` must be JSON-serializable.** No `Headers` instances, no `AbortSignal`, no `Blob` — they don't survive `page.evaluate`. Use plain `{ method, headers: {}, body: string }`.
- **Auth checks come before data output.** When a command may emit response bodies (`--raw`, frame dumps, etc.), run `looksUnauthenticated` first so an Okta HTML redirect doesn't get printed as if it were data.

## Comments and docs

- **JSDoc on every exported function or interface.** One sentence is enough — say what it does, not how.
- **Comment WHY, not WHAT.** Examples worth keeping: the page-evaluate serialization note in `session.ts`, the "Grafana lazy-renders" comment in `shot.ts`, the `apiFetch` CSRF rationale. Don't add comments that just restate the next line.
- **No "removed X" / "moved to Y" / "added for issue Z" comments.** Git history handles that.
- **Don't add task-tracking artifacts** (status docs, plan files, change logs of your edits) unless the user asks. Work from conversation context.

## Small things that bite

- **Mark shared config-like objects `as const`** if they're exported and could be mistaken for mutable (e.g. `uidPositional` in `runtime.ts`).
- **Heuristic regexes**: prefer tight alternations (`/executable doesn'?t exist|chromium.*not found/i`) over loose single tokens (`/executable/i`). Match what the upstream library actually says; recheck after dep upgrades.
- **`exactOptionalPropertyTypes` means `foo?: T` and `foo?: T | undefined` differ.** Use `foo?: T` for "may be omitted" and the `| undefined` form only when callers genuinely need to pass `{ foo: undefined }`.

## When in doubt

- Match the surrounding code's style and structure.
- If a change wants to grow a file past one clear responsibility, split the file instead.
- If a fix wants to bypass strictness (a cast, a flag flip, a `// @ts-expect-error`), find the underlying type problem first.
