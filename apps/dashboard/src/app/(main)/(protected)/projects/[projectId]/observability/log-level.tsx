"use client";

import { DesignBadge, type DesignBadgeColor } from "@/components/design-components";

/**
 * The severity chip shared by Logs and Issues.
 *
 * This used to be a hand-rolled pill inside `logs/page-client.tsx` whose own
 * comment admitted it existed only because `DesignBadge` had no muted color.
 * `DesignBadge` now has `zinc`, so the chip is the house component again and
 * the two pages cannot drift apart on what an "error" chip looks like.
 */

const LEVEL_BADGE_COLORS = new Map<string, DesignBadgeColor>([
  ["trace", "zinc"],
  ["debug", "zinc"],
  ["info", "blue"],
  ["warn", "orange"],
  ["error", "red"],
  ["fatal", "red"],
]);

export function logLevelBadgeColor(level: string): DesignBadgeColor {
  // A level outside the known set means malformed ingested data; render it
  // neutral with its raw text instead of crashing the whole grid over one row.
  return LEVEL_BADGE_COLORS.get(level) ?? "zinc";
}

export function LogLevelChip({ level }: { level: string }) {
  return (
    <DesignBadge
      label={level === "" ? "—" : level.toUpperCase()}
      color={logLevelBadgeColor(level)}
      size="sm"
    />
  );
}
