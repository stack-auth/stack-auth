"use client";

import { DesignButton } from "@/components/design-components";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowsClockwiseIcon, DatabaseIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  DB_PITR,
  DB_REPLICAS,
  DEFERRED_CLEANUP_CAPTION,
  MIGRATIONS,
} from "../fixtures/databases";
import type { DbReplica, DbReplicaRole } from "../fixtures/types";
import { BlastRadiusPanel } from "./blast-radius-panel";
import { BranchTree } from "./branch-tree";
import { CloneWizard } from "./clone-wizard";
import { CompatMatrix } from "./compat-matrix";
import { CopilotRail } from "./copilot-rail";
import { QueryInsights } from "./query-insights";
import { SchemaBrowser } from "./schema-browser";
import { CxChip, CxPanel, StatusDot, cx } from "./ui-kit";

const ROLE_LABELS: Record<DbReplicaRole, string> = {
  "primary": "Primary",
  "sync-replica": "Sync replica",
  "async-replica": "Async replica",
  "standby": "Cross-cloud standby",
};

type DatabaseWorkspaceProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

export function DatabaseWorkspace({ open, onOpenChange }: DatabaseWorkspaceProps) {
  const [selectedBranchId, setSelectedBranchId] = useState("db-prod");
  // Mock-only: "promoting" briefly animates the standby taking over, then settles back.
  const [promotedReplicaId, setPromotedReplicaId] = useState<string | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl" hasCloseButton>
        <SheetHeader className={`space-y-1 border-b px-5 py-4 text-left ${cx.hairline}`}>
          <div className="flex items-center gap-2">
            <DatabaseIcon className="size-4" />
            <SheetTitle className="text-base">Production DB</SheetTitle>
            <CxChip tone="ok">both versions ok</CxChip>
            <CxChip>2 TB</CxChip>
          </div>
          <SheetDescription className="text-xs">
            Replication, branches, safe copies, and change safety — everything for this database.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="replication" className="flex min-h-0 flex-1 flex-col">
          <div className={`shrink-0 border-b px-4 py-2 ${cx.hairline}`}>
            <TabsList className="h-8 flex-wrap">
              <TabsTrigger value="replication" className="text-xs">Replication</TabsTrigger>
              <TabsTrigger value="branches" className="text-xs">Branches</TabsTrigger>
              <TabsTrigger value="compat" className="text-xs">Compatibility</TabsTrigger>
              <TabsTrigger value="copies" className="text-xs">Safe copies</TabsTrigger>
              <TabsTrigger value="schema" className="text-xs">Schema</TabsTrigger>
              <TabsTrigger value="queries" className="text-xs">Queries</TabsTrigger>
              <TabsTrigger value="copilot" className="text-xs">Copilot</TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="replication" className="mt-0 space-y-3">
              <ReplicationPanel
                promotedReplicaId={promotedReplicaId}
                onPromote={async (replicaId) => {
                  setPromotedReplicaId(replicaId);
                  await new Promise((resolve) => setTimeout(resolve, 900));
                  setPromotedReplicaId(null);
                }}
              />
              <PitrPanel />
            </TabsContent>

            <TabsContent value="branches" className="mt-0">
              <CxPanel title="Database branches" bodyClassName="min-h-0">
                <BranchTree selectedId={selectedBranchId} onSelect={setSelectedBranchId} />
              </CxPanel>
            </TabsContent>

            <TabsContent value="compat" className="mt-0 space-y-3">
              <CompatMatrix />
              <MigrationSplitPanel />
              <BlastRadiusPanel />
            </TabsContent>

            <TabsContent value="copies" className="mt-0">
              <CloneWizard />
            </TabsContent>

            <TabsContent value="schema" className="mt-0">
              <SchemaBrowser />
            </TabsContent>

            <TabsContent value="queries" className="mt-0">
              <QueryInsights />
            </TabsContent>

            <TabsContent value="copilot" className="mt-0">
              <CxPanel title="Database copilot" bodyClassName="min-h-[24rem]">
                <CopilotRail />
              </CxPanel>
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function ReplicationPanel({
  promotedReplicaId,
  onPromote,
}: {
  promotedReplicaId: string | null,
  onPromote: (replicaId: string) => Promise<void>,
}) {
  return (
    <CxPanel
      title="Replication"
      meta={<CxChip tone="ok">{DB_REPLICAS.length - 1} replicas live</CxChip>}
      bodyClassName="divide-y divide-black/[0.05] dark:divide-white/[0.05]"
    >
      {DB_REPLICAS.map((replica) => (
        <ReplicaRow
          key={replica.id}
          replica={replica}
          promoting={promotedReplicaId === replica.id}
          onPromote={() => onPromote(replica.id)}
        />
      ))}
    </CxPanel>
  );
}

function ReplicaRow({
  replica,
  promoting,
  onPromote,
}: {
  replica: DbReplica,
  promoting: boolean,
  onPromote: () => Promise<void>,
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <StatusDot status={replica.state === "live" ? "ok" : replica.state === "catching-up" ? "warn" : "idle"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium">{ROLE_LABELS[replica.role]}</p>
          <CxChip>{replica.provider} {replica.region}</CxChip>
        </div>
        <p className={`mt-0.5 ${cx.mono} text-muted-foreground`}>
          {replica.role === "primary" ? "accepting writes" : `lag ${replica.lagMs}ms · ${replica.state}`}
        </p>
      </div>
      {replica.promotable && (
        <DesignButton size="sm" variant="outline" loading={promoting} loadingStyle="disabled" onClick={onPromote}>
          <ArrowsClockwiseIcon className="mr-1.5 size-3.5" />
          Promote
        </DesignButton>
      )}
    </div>
  );
}

function PitrPanel() {
  const oldestRestore = new Date(DB_PITR.oldestRestorePoint);
  const lastSnapshot = new Date(DB_PITR.lastSnapshotAt);

  return (
    <CxPanel
      title="Point-in-time recovery"
      meta={<CxChip tone="ok">{DB_PITR.retentionDays}-day window</CxChip>}
      bodyClassName="space-y-2 p-4"
    >
      <PitrRow label="Oldest restore point" value={oldestRestore.toLocaleString()} />
      <PitrRow label="Last snapshot" value={lastSnapshot.toLocaleString()} />
      <PitrRow label="WAL archive lag" value={`${DB_PITR.walArchiveLagSeconds}s`} />
      <p className={cx.muted}>
        Restore any second in the last {DB_PITR.retentionDays} days to a new branch — production stays untouched.
      </p>
    </CxPanel>
  );
}

function PitrRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] pb-2 last:border-0 dark:border-white/[0.05]">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className={`${cx.mono} text-foreground`}>{value}</span>
    </div>
  );
}

function MigrationSplitPanel() {
  const migration = MIGRATIONS[0];

  return (
    <CxPanel title="How this change was split" bodyClassName="space-y-3 p-4">
      <p className="text-sm leading-6 text-muted-foreground">{DEFERRED_CLEANUP_CAPTION}</p>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-2 rounded-md border border-[#42946e]/25 bg-[#42946e]/[0.06] p-3">
          <div className="flex items-center gap-2">
            <StatusDot status="ok" />
            <p className="text-[11px] font-medium uppercase tracking-[0.12em]">Applied now</p>
          </div>
          {migration.steps.filter((step) => step.kind === "expand").map((step) => (
            <div key={step.id} className="rounded-md bg-background/70 px-3 py-2">
              <p className="text-xs font-medium">{step.plainLabel}</p>
              <pre className="mt-1 overflow-x-auto font-mono text-[10px] text-muted-foreground">{step.sql}</pre>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-3">
          <div className="flex items-center gap-2">
            <StatusDot status="warn" />
            <p className="text-[11px] font-medium uppercase tracking-[0.12em]">Waiting safely</p>
          </div>
          {migration.steps.filter((step) => step.kind === "contract").map((step) => (
            <div key={step.id} className="rounded-md bg-background/70 px-3 py-2">
              <p className="text-xs font-medium">{step.plainLabel}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{step.heldBy}</p>
              <pre className="mt-1 overflow-x-auto font-mono text-[10px] text-muted-foreground">{step.sql}</pre>
            </div>
          ))}
        </div>
      </div>
    </CxPanel>
  );
}
