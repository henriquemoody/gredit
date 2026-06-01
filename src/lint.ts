/** Pure, network-free validation of a Grafana dashboard model. */

export interface LintIssue {
  level: "error" | "warning";
  message: string;
}

export interface DashboardModel {
  uid?: string;
  title?: string;
  schemaVersion?: number;
  panels?: Panel[];
  templating?: { list?: unknown[] };
  [key: string]: unknown;
}

export interface Panel {
  id?: number;
  type?: string;
  title?: string;
  gridPos?: { x: number; y: number; w: number; h: number };
  panels?: Panel[]; // rows can nest panels
  [key: string]: unknown;
}

export function collectPanels(panels: Panel[] | undefined, acc: Panel[] = []): Panel[] {
  if (!panels) return acc;
  for (const p of panels) {
    acc.push(p);
    if (Array.isArray(p.panels)) collectPanels(p.panels, acc);
  }
  return acc;
}

/**
 * Structural sanity checks that catch the common ways an automated edit breaks
 * a dashboard before it is pushed. Drift in uid/schemaVersion vs. the original
 * is intentionally NOT checked here — that surfaces cleanly via `git diff` on
 * the committed JSON.
 */
export function lintDashboard(model: DashboardModel): LintIssue[] {
  const issues: LintIssue[] = [];

  if (model.uid == null || model.uid === "") {
    issues.push({ level: "error", message: "missing 'uid' (push would create a duplicate dashboard)" });
  }
  if (!model.title) {
    issues.push({ level: "error", message: "missing 'title'" });
  }
  if (typeof model.schemaVersion !== "number") {
    issues.push({ level: "warning", message: "missing 'schemaVersion'" });
  }
  if (!model.templating || !Array.isArray(model.templating.list)) {
    issues.push({
      level: "warning",
      message: "no 'templating.list' block — dashboard variables may have been dropped",
    });
  }

  const panels = collectPanels(model.panels);
  if (panels.length === 0) {
    issues.push({ level: "warning", message: "dashboard has no panels" });
  }

  const seenIds = new Map<number, number>();
  panels.forEach((p, i) => {
    const where = p.title ? `panel "${p.title}"` : `panel #${i}`;
    if (typeof p.id !== "number") {
      issues.push({ level: "error", message: `${where}: missing numeric 'id'` });
    } else {
      seenIds.set(p.id, (seenIds.get(p.id) ?? 0) + 1);
    }
    if (!p.type) {
      issues.push({ level: "error", message: `${where}: missing 'type'` });
    }
    if (!p.gridPos || ["x", "y", "w", "h"].some((k) => typeof (p.gridPos as any)?.[k] !== "number")) {
      issues.push({ level: "error", message: `${where}: invalid or missing 'gridPos'` });
    }
  });

  for (const [id, count] of seenIds) {
    if (count > 1) {
      issues.push({ level: "error", message: `duplicate panel id ${id} (${count} panels share it)` });
    }
  }

  return issues;
}
