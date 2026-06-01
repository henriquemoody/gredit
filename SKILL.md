---
name: gredit
description: Edit and publish Grafana dashboards using the gredit CLI. Use when working on Grafana dashboard JSON files — fixing panels, adding metrics, reorganizing layout, or verifying queries.
---

# gredit — Grafana dashboard editor

## Commands

```sh
gredit pull [uid|alias]    # download live dashboard to dashboards/<uid>.json
gredit lint [uid|alias]    # validate local JSON (nonzero exit on error)
gredit push [uid|alias]    # lint + upload with overwrite=true
gredit shot  [uid|alias]   # screenshot the rendered dashboard
gredit preview [uid|alias] # open in browser for interactive review

gredit panel get [uid|alias] <title> [path]         # print panel JSON or a specific field
gredit panel set [uid|alias] <title> <path> <value> # set a panel field and write back to disk
```

`path` uses dot and bracket notation: `gridPos.h`, `targets[0].expression`, `title`.
`value` is parsed as JSON first (so `11` → number, `true` → boolean); falls back to a plain string, so expressions pass through without quoting.

## Config (gredit.json)

```json
{
  "baseUrl": "https://grafana.company.com",
  "profileDir": ".gredit-profile",
  "dashboardsDir": "dashboards",
  "uid": "abc123",
  "dashboards": { "main": "abc123" }
}
```

Env overrides: `GRAFANA_BASE_URL`, `GRAFANA_PROFILE_DIR`, `GRAFANA_DASHBOARDS_DIR`, `GRAFANA_UID`, `GRAFANA_HEADLESS=1`

## Workflow

1. Edit `dashboards/<uid>.json` directly, or use `gredit panel set` for targeted field edits
2. `gredit lint` — fix any errors before pushing
3. `gredit push` — upload to Grafana
4. `gredit shot` or `gredit preview` — verify visually

When the user asks to fix issues one by one: make one change, push, wait for confirmation before the next.
