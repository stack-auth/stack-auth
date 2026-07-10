"use client";

import { TableIcon } from "@phosphor-icons/react";
import { SCHEMA_TABLES } from "../fixtures/databases";
import type { SensitiveKind } from "../fixtures/types";
import { CxChip, CxPanel, cx } from "./ui-kit";

const SENSITIVE_TONES: Record<SensitiveKind, "warn" | "bad"> = {
  email: "warn",
  name: "warn",
  phone: "bad",
  freetext: "bad",
  ssn: "bad",
  address: "warn",
};

export function SensitiveKindChip(props: { kind: SensitiveKind }) {
  return <CxChip tone={SENSITIVE_TONES[props.kind]}>{props.kind}</CxChip>;
}

export function SchemaBrowser() {
  return (
    <CxPanel
      title="Schema"
      meta={<CxChip>{SCHEMA_TABLES.length} tables</CxChip>}
      bodyClassName="space-y-3 p-3"
    >
      <p className={cx.muted}>
        Sensitive fields are marked in your schema — anonymization uses them automatically.
      </p>
      {SCHEMA_TABLES.map((table) => (
        <div key={table.name} className={cx.panelInset}>
          <div className={`flex items-center gap-2 border-b px-3 py-2 ${cx.hairline}`}>
            <TableIcon className="size-3.5 text-muted-foreground" />
            <span className={`${cx.mono} font-semibold`}>{table.name}</span>
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{table.columns.length} columns</span>
          </div>
          <div>
            {table.columns.map((column) => (
              <div
                key={column.name}
                className={`flex items-center gap-2 border-b border-black/[0.04] px-3 py-1.5 text-xs last:border-0 dark:border-white/[0.04] ${
                  column.sensitive == null ? "" : "bg-amber-500/[0.05]"
                }`}
              >
                <span className={`min-w-0 flex-1 truncate ${cx.mono}`}>{column.name}</span>
                <span className={`${cx.mono} text-muted-foreground`}>{column.type}{column.nullable ? "?" : ""}</span>
                {column.sensitive != null && <SensitiveKindChip kind={column.sensitive.kind} />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </CxPanel>
  );
}
