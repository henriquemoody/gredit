# gredit — gaps identified during real usage

## What `gredit panel get` doesn't cover

When working on a dashboard edit that required understanding the full layout, `gredit panel get` wasn't enough. The missing pieces:

### 1. Panel overview (`gredit panels`)

A command to list all panels with id, title, type, and gridPos — essential for mapping which panels belong to which row and understanding the overall layout before making changes. Without it, you fall back to Python or `jq` to parse the raw JSON.

### 2. Template variable inspection

No way to inspect `templating.list` (variable names, types, options) without reading the raw JSON. A `gredit vars` command (or extending `panel get` to cover dashboard-level metadata) would fill this.

### 3. Dashboard metadata

Things like the max panel ID (needed when adding a new panel) or the dashboard version aren't accessible via any gredit command. Either a `gredit info` command or surfacing these in existing commands would help.

## What already works well

- `gredit panel get <panel>` for reading a single known panel's full JSON
- `gredit panel set` for targeted field edits without touching the rest of the file
- `gredit lint` / `gredit validate` / `gredit push --message` workflow is solid
