"use client";

import { COMPAT_MATRIX, DEFERRED_CLEANUP_CAPTION } from "../fixtures/databases";
import type { CompatVerdict } from "../fixtures/types";
import { CxChip, CxPanel, StatusDot, cx } from "./ui-kit";

const verdictTone = new Map<CompatVerdict, { label: string, className: string }>([
  ["green", { label: "ok", className: "bg-[#42946e]/15 text-[#2f6b4f] dark:text-[#7dcea8]" }],
  ["amber", { label: "careful", className: "bg-amber-500/15 text-amber-800 dark:text-amber-200" }],
  ["red", { label: "no", className: "bg-red-500/15 text-red-700 dark:text-red-300" }],
]);

function getCell(rowIndex: number, columnIndex: number): CompatVerdict {
  return COMPAT_MATRIX.cells[rowIndex][columnIndex];
}

export function CompatMatrix() {
  const activeVersions = new Set([
    COMPAT_MATRIX.activeWindow.from,
    COMPAT_MATRIX.activeWindow.to,
  ]);

  return (
    <CxPanel
      title="Compatibility"
      meta={<CxChip tone="ok">Safe to undo</CxChip>}
      bodyClassName="space-y-4 p-4"
    >
      <p className="text-sm leading-6 text-muted-foreground">{COMPAT_MATRIX.headline}</p>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-[32rem] gap-1.5"
          style={{
            gridTemplateColumns: `7.5rem repeat(${COMPAT_MATRIX.schemaStates.length}, minmax(6.5rem, 1fr))`,
          }}
        >
          <div />
          {COMPAT_MATRIX.schemaStates.map((schemaState) => (
            <div key={schemaState} className="px-2 pb-1 text-center text-[11px] text-muted-foreground">
              {schemaState}
            </div>
          ))}

          {COMPAT_MATRIX.versions.map((version, rowIndex) => {
            const isActive = activeVersions.has(version);
            return (
              <div key={version} className="contents">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className={cx.mono}>{version}</span>
                  {isActive && <StatusDot status="info" />}
                </div>
                {COMPAT_MATRIX.schemaStates.map((schemaState, columnIndex) => {
                  const verdict = getCell(rowIndex, columnIndex);
                  const tone = verdictTone.get(verdict);
                  if (tone == null) throw new Error(`Unknown verdict "${verdict}"`);
                  return (
                    <div
                      key={`${version}-${schemaState}`}
                      className={[
                        "flex min-h-9 items-center justify-center rounded-md text-[11px] font-medium",
                        tone.className,
                        isActive ? "ring-1 ring-[#7c6cff]/40" : "",
                      ].join(" ")}
                    >
                      {tone.label}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <p className={cx.muted}>Green means these versions can share your database.</p>
      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-950 dark:text-amber-100">
        {DEFERRED_CLEANUP_CAPTION}
      </div>
    </CxPanel>
  );
}
