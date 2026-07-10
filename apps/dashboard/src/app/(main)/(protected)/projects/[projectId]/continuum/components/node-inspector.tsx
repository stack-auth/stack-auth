"use client";

import { DesignButton } from "@/components/design-components";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowsClockwiseIcon,
  CloudIcon,
  CopyIcon,
  DatabaseIcon,
  HardDrivesIcon,
  PushPinIcon,
  RocketLaunchIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { setCellState } from "../continuum-store";
import { DB_BRANCHES, DB_REPLICAS } from "../fixtures/databases";
import { RELEASES } from "../fixtures/releases";
import { cellById, tenantById } from "../fixtures/tenants";
import type { ContinuumMapNode } from "../fixtures/types";
import { BuildLogViewer } from "./build-log-viewer";
import { CxChip, StatusDot, cellStateToCxStatus, cx } from "./ui-kit";

type NodeInspectorProps = {
  node: ContinuumMapNode | null,
  onClose: () => void,
  cellStateOverrides?: Map<string, string>,
};

function cellIdFromNode(nodeId: string): string | null {
  if (!nodeId.startsWith("n-cell-")) return null;
  return nodeId.replace(/^n-/, "");
}

function customerIdFromNode(nodeId: string): string | null {
  const map = new Map([
    ["n-atlas", "t-atlas"],
    ["n-northstar", "t-northstar"],
    ["n-lumen", "t-lumen"],
  ]);
  return map.get(nodeId) ?? null;
}

export function NodeInspector({ node, onClose, cellStateOverrides }: NodeInspectorProps) {
  const open = node != null;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md" hasCloseButton>
        {node != null && (
          <InspectorBody node={node} cellStateOverrides={cellStateOverrides} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function InspectorBody({
  node,
  cellStateOverrides,
}: {
  node: ContinuumMapNode,
  cellStateOverrides?: Map<string, string>,
}) {
  switch (node.kind) {
    case "customer": {
      return <CustomerBody node={node} />;
    }
    case "cell": {
      return <CellBody node={node} cellStateOverrides={cellStateOverrides} />;
    }
    case "release": {
      return <ReleaseBody node={node} />;
    }
    case "database": {
      return <DatabaseBody node={node} />;
    }
    case "provider": {
      return <ProviderBody node={node} />;
    }
    case "region": {
      return <ProviderBody node={node} />;
    }
    default: {
      const exhaustive: never = node.kind;
      throw new Error(`Unhandled node kind: ${exhaustive}`);
    }
  }
}

function InspectorChrome({
  icon: Icon,
  title,
  subtitle,
  status,
  children,
}: {
  icon: React.ElementType,
  title: string,
  subtitle: string,
  status: "ok" | "warn" | "bad" | "info" | "idle" | "pinned",
  children: React.ReactNode,
}) {
  return (
    <>
      <SheetHeader className="space-y-3 border-b border-black/[0.08] px-5 py-4 text-left dark:border-white/[0.08]">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-md border border-black/[0.08] bg-black/[0.03] dark:border-white/[0.08] dark:bg-white/[0.04]">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusDot status={status} />
              <SheetTitle className="truncate text-base font-semibold tracking-tight">{title}</SheetTitle>
            </div>
            <SheetDescription className="mt-1 text-xs text-muted-foreground">{subtitle}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
    </>
  );
}

function CustomerBody({ node }: { node: ContinuumMapNode }) {
  const tenantId = customerIdFromNode(node.id);
  if (tenantId == null) throw new Error(`No tenant mapped for node ${node.id}`);
  const tenant = tenantById(tenantId);

  return (
    <InspectorChrome
      icon={UsersIcon}
      title={tenant.name}
      subtitle={`${tenant.plan} · ${tenant.userCount.toLocaleString()} users · ${tenant.residency}`}
      status="ok"
    >
      <Row label="ARR" value={`$${(tenant.arrUsd / 1000).toFixed(0)}k`} />
      <Row label="Users" value={tenant.userCount.toLocaleString()} />
      <Row label="Residency" value={tenant.residency} />
      <Section title="Recent sessions">
        {["Invite admin · 4m ago", "SSO sign-in · 18m ago", "Billing settings · 41m ago"].map((line) => (
          <p key={line} className="font-mono text-[11px] text-muted-foreground">{line}</p>
        ))}
      </Section>
    </InspectorChrome>
  );
}

function CellBody({
  node,
  cellStateOverrides,
}: {
  node: ContinuumMapNode,
  cellStateOverrides?: Map<string, string>,
}) {
  const cellId = cellIdFromNode(node.id);
  if (cellId == null) throw new Error(`No cell mapped for node ${node.id}`);
  const cell = cellById(cellId);
  const tenant = tenantById(cell.tenantId);
  const state = cellStateOverrides?.get(cellId) ?? cell.state;

  return (
    <InspectorChrome
      icon={HardDrivesIcon}
      title={tenant.name}
      subtitle={`Cell · ${cell.provider} ${cell.regionId}`}
      status={cellStateToCxStatus(state)}
    >
      <Row label="Release" value={cell.releaseVersion} />
      <Row label="State" value={state.replace("_", " ")} />
      <Row label="Replication lag" value={`${cell.replicationLagMs}ms`} />
      <Row label="Recovery" value={`${cell.recovery.mode} → ${cell.recovery.standbyProvider}`} />

      <Section title="Actions">
        <div className="flex flex-wrap gap-2">
          <DesignButton size="sm" variant="outline" onClick={() => setCellState(cellId, "pinned")}>
            <PushPinIcon className="mr-1.5 size-3.5" />
            Pin
          </DesignButton>
          <DesignButton size="sm" variant="outline" onClick={() => setCellState(cellId, "protected")}>
            Isolate
          </DesignButton>
          <DesignButton
            size="sm"
            variant="outline"
            onClick={async () => {
              setCellState(cellId, "failing_over");
              await new Promise((r) => setTimeout(r, 700));
              setCellState(cellId, "healthy");
            }}
          >
            <ArrowsClockwiseIcon className="mr-1.5 size-3.5" />
            Fail over
          </DesignButton>
          <DesignButton size="sm" variant="outline">
            <CopyIcon className="mr-1.5 size-3.5" />
            Clone
          </DesignButton>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Sessions lost on failover: 0</p>
      </Section>
    </InspectorChrome>
  );
}

function ReleaseBody({ node }: { node: ContinuumMapNode }) {
  const release = RELEASES[0];
  return (
    <InspectorChrome
      icon={RocketLaunchIcon}
      title={node.label}
      subtitle={release.title}
      status="ok"
    >
      <div className="flex flex-wrap gap-1.5">
        <CxChip tone="accent">{release.status.replace("_", " ")}</CxChip>
        <CxChip>{release.framework}</CxChip>
        <CxChip>{release.connectedRepo}</CxChip>
      </div>
      <Row label="Commits" value={String(release.commits.length)} />
      <Row label="Blast radius" value={`${release.blastRadiusUsers.toLocaleString()} users`} />
      <Section title="Build logs">
        <div className="-mx-1">
          <BuildLogViewer buildLog={release.buildLog} running={false} />
        </div>
      </Section>
    </InspectorChrome>
  );
}

function DatabaseBody({ node }: { node: ContinuumMapNode }) {
  return (
    <InspectorChrome
      icon={DatabaseIcon}
      title={node.label}
      subtitle="Shared across active versions"
      status="ok"
    >
      <Row label="Size" value="2 TB" />
      <Row label="Compat" value="Both versions ok" />
      <Section title="Replication">
        <div className="space-y-2 rounded-md border border-black/[0.06] p-3 dark:border-white/[0.06]">
          {DB_REPLICAS.map((replica) => (
            <div key={replica.id} className="flex items-center justify-between text-[12px]">
              <span>{replica.role} → {replica.provider} {replica.region}</span>
              {replica.role === "primary"
                ? <CxChip tone="ok">live</CxChip>
                : <span className={cx.mono}>lag {replica.lagMs}ms</span>}
            </div>
          ))}
        </div>
      </Section>
      <Section title="Branches">
        {DB_BRANCHES.map((branch) => (
          <p key={branch.id} className="font-mono text-[11px] text-muted-foreground">{branch.name}</p>
        ))}
      </Section>
    </InspectorChrome>
  );
}

function ProviderBody({ node }: { node: ContinuumMapNode }) {
  return (
    <InspectorChrome
      icon={CloudIcon}
      title={node.label}
      subtitle={node.subtitle ?? "Cloud provider"}
      status="ok"
    >
      <Row label="Role" value={node.label === "AWS" ? "Primary" : "Standby"} />
      <Row label="Region" value={node.subtitle ?? "—"} />
      <Section title="Traffic">
        <p className="text-[12px] text-muted-foreground">
          Cells and databases can fail over here without forcing customers to sign in again.
        </p>
      </Section>
    </InspectorChrome>
  );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div>
      <p className={cx.label}>{title}</p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/[0.05] py-2 last:border-0 dark:border-white/[0.05]">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-foreground">{value}</span>
    </div>
  );
}
