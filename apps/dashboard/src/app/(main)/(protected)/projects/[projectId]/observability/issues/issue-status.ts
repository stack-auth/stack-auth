import type { DesignBadgeColor } from "@/components/design-components";
import type { IssueListItem, IssueStatus, IssueSubstatus } from "./issues-data";

/**
 * The Issue lifecycle, as pure data.
 *
 * The interesting part is `IssueStatusOverride`: an optimistic status change is
 * **versioned**, not permanent. It records the `updated_at_millis` the row had
 * when the user clicked, and is dropped as soon as the server returns a row
 * that is newer. A permanent override would keep showing "Resolved" after the
 * issue automatically regressed — i.e. it would hide exactly the event the
 * resolve was a bet against. `useDataSource` deliberately keeps prior rows
 * while refetching, which is what lets the reconciliation happen without the
 * list flashing.
 */

export type IssueStatusAction = "resolve" | "unresolve" | "ignore";

export function nextStatusForAction(action: IssueStatusAction): IssueStatus {
  switch (action) {
    case "resolve": {
      return "resolved";
    }
    case "unresolve": {
      return "unresolved";
    }
    case "ignore": {
      return "ignored";
    }
  }
}

export const ISSUE_STATUS_ACTION_LABELS = new Map<IssueStatusAction, string>([
  ["resolve", "Resolve"],
  ["unresolve", "Unresolve"],
  ["ignore", "Ignore"],
]);

export function issueStatusActionLabel(action: IssueStatusAction): string {
  const label = ISSUE_STATUS_ACTION_LABELS.get(action);
  if (label == null) throw new Error(`Missing label for issue status action: ${action}`);
  return label;
}

export type IssueStatusBadge = { label: string, color: DesignBadgeColor };

/**
 * `null` for a plain unresolved issue.
 *
 * Under the default Unresolved filter that is nearly every row, and a column
 * where nearly every cell carries the same badge is a column of noise. The
 * states worth a badge are the ones that change how you triage: it came back
 * (`regressed`), it's new to this window (`new`), or someone already dealt with
 * it (`resolved` / `ignored`).
 */
export function issueStatusBadge(issue: { status: IssueStatus, substatus: IssueSubstatus }): IssueStatusBadge | null {
  switch (issue.status) {
    case "resolved": {
      return { label: "Resolved", color: "green" };
    }
    case "ignored": {
      return { label: "Ignored", color: "zinc" };
    }
    case "unresolved": {
      if (issue.substatus === "regressed") return { label: "Regressed", color: "orange" };
      if (issue.substatus === "new") return { label: "New", color: "blue" };
      return null;
    }
  }
}

export type IssueStatusOverride = {
  status: IssueStatus,
  /** The row's `updated_at_millis` at the moment the override was applied. */
  updatedAtMillis: number,
};

export type IssueStatusOverrides = ReadonlyMap<string, IssueStatusOverride>;

export const NO_ISSUE_STATUS_OVERRIDES: IssueStatusOverrides = new Map();

export function applyOptimisticStatus(
  overrides: IssueStatusOverrides,
  issueId: string,
  status: IssueStatus,
  updatedAtMillis: number,
): Map<string, IssueStatusOverride> {
  const next = new Map(overrides);
  next.set(issueId, { status, updatedAtMillis });
  return next;
}

export function clearOptimisticStatus(
  overrides: IssueStatusOverrides,
  issueId: string,
): Map<string, IssueStatusOverride> {
  const next = new Map(overrides);
  next.delete(issueId);
  return next;
}

/**
 * Drops overrides the server has caught up with (or moved past).
 *
 * Returns the SAME map reference when nothing changed, so this can be called
 * from a render-phase `useMemo` without churning identity on every fetch.
 */
export function reconcileIssueStatusOverrides(
  overrides: IssueStatusOverrides,
  rows: readonly IssueListItem[],
): IssueStatusOverrides {
  if (overrides.size === 0) return overrides;
  let next: Map<string, IssueStatusOverride> | null = null;
  for (const row of rows) {
    const override = overrides.get(row.id);
    if (override == null) continue;
    if (row.updated_at_millis <= override.updatedAtMillis) continue;
    next ??= new Map(overrides);
    next.delete(row.id);
  }
  return next ?? overrides;
}

/** The status to render for a row, honoring a still-live optimistic override. */
export function resolveIssueRowStatus(
  issue: IssueListItem,
  overrides: IssueStatusOverrides,
): { status: IssueStatus, isOptimistic: boolean } {
  const override = overrides.get(issue.id);
  if (override == null || issue.updated_at_millis > override.updatedAtMillis) {
    return { status: issue.status, isOptimistic: false };
  }
  return { status: override.status, isOptimistic: override.status !== issue.status };
}

/**
 * The primary action offered on a row / in the detail header. Resolved and
 * ignored issues both offer the way back, so a mis-click is one click to undo.
 */
export function primaryIssueStatusAction(status: IssueStatus): IssueStatusAction {
  return status === "unresolved" ? "resolve" : "unresolve";
}
