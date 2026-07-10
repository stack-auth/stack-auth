"use client";

import { SLOW_QUERIES } from "../fixtures/databases";
import { CxChip, CxPanel, cx } from "./ui-kit";

export function QueryInsights() {
  return (
    <CxPanel
      title="Query insights"
      meta={<CxChip tone="warn">{SLOW_QUERIES.length} slow paths</CxChip>}
      bodyClassName="space-y-3 p-3"
    >
      {SLOW_QUERIES.map((query) => (
        <div key={query.id} className={`${cx.panelInset} p-3`}>
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            <CxChip tone="warn">p95 {query.p95Ms} ms</CxChip>
            <span className="text-[11px] text-muted-foreground">{query.callsPerMin.toLocaleString()} calls/min</span>
          </div>
          <pre className={`mt-2 overflow-x-auto rounded-md bg-black/[0.04] p-2.5 ${cx.mono} text-muted-foreground dark:bg-white/[0.04]`}>{query.sql}</pre>
          <p className="mt-2 text-xs leading-5">{query.plainHint}</p>
          <pre className={`mt-2 overflow-x-auto rounded-md bg-black/[0.04] p-2.5 ${cx.mono} text-muted-foreground dark:bg-white/[0.04]`}>{query.suggestedIndex}</pre>
        </div>
      ))}
    </CxPanel>
  );
}
