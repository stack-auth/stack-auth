"use client";

import { DatabaseIcon, GitBranchIcon, LinkIcon } from "@phosphor-icons/react";
import { DB_BRANCHES } from "../fixtures/databases";
import type { DbBranch } from "../fixtures/types";
import { CxChip } from "./ui-kit";

const KIND_TONES = {
  production: "ok",
  preview: "accent",
  dev: "neutral",
  forensic: "warn",
  clone: "neutral",
} as const;

function sizeLabel(sizeGb: number) {
  return sizeGb >= 1_024 ? `${sizeGb / 1_024} TB` : `${sizeGb} GB`;
}

function BranchRow(props: {
  branch: DbBranch,
  depth: number,
  selected: boolean,
  onSelect: (id: string) => void,
}) {
  return (
    <button
      type="button"
      onClick={() => props.onSelect(props.branch.id)}
      className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        props.selected ? "bg-primary/[0.08] ring-1 ring-primary/20" : "hover:bg-foreground/[0.04]"
      }`}
      style={{ paddingLeft: `${12 + props.depth * 18}px` }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {props.depth === 0 ? <DatabaseIcon className="h-4 w-4 shrink-0" /> : <GitBranchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.branch.name}</span>
        <CxChip tone={KIND_TONES[props.branch.kind]}>{props.branch.kind}</CxChip>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-6 text-[11px] text-muted-foreground tabular-nums">
        <span>{sizeLabel(props.branch.sizeGb)}</span>
        {props.branch.releaseVersion != null && <span>· {props.branch.releaseVersion}</span>}
      </div>
      {props.branch.previewUrl != null && (
        <div className="mt-1 flex min-w-0 items-center gap-1 pl-6 text-[11px] text-primary">
          <LinkIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{props.branch.previewUrl}</span>
        </div>
      )}
    </button>
  );
}

export function BranchTree(props: { selectedId: string, onSelect: (id: string) => void }) {
  const roots = DB_BRANCHES.filter((branch) => branch.parentId == null);
  const childrenFor = (id: string) => DB_BRANCHES.filter((branch) => branch.parentId === id);

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider">Database branches</p>
        <p className="mt-1 text-xs text-muted-foreground">Production, previews, and safe copies.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {roots.map((root) => (
          <div key={root.id}>
            <BranchRow branch={root} depth={0} selected={props.selectedId === root.id} onSelect={props.onSelect} />
            {childrenFor(root.id).map((child) => (
              <BranchRow key={child.id} branch={child} depth={1} selected={props.selectedId === child.id} onSelect={props.onSelect} />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
