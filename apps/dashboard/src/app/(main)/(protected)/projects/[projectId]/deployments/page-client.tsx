"use client";

import { DesignBadge } from "@/components/design-components";
import { getAppStageLabel } from "@/lib/apps-utils";
import { useAdminApp } from "../use-admin-app";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import type { AdminDeploymentRunJson } from "@hexclave/next";
import { useState } from "react";
import { BoardCanvas } from "./board-canvas";
import { DeploymentsList } from "./deployments-list";
import { DeploymentDetailContent } from "./panel-content";

const stageLabel = getAppStageLabel("deployments-alpha");

type Tab = "deployments" | "services";

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const [tab, setTab] = useState<Tab>("deployments");
  // A run opened from a deployment's service list. Kept here rather than inside
  // DeploymentsList so the logs view can take over the whole page — build output
  // is wide, and it was unreadable in the old side panel.
  const [openRun, setOpenRun] = useState<AdminDeploymentRunJson | null>(null);

  return (
    <AppEnabledGuard appId="deployments-alpha">
      <PageLayout
        fillWidth
        title="Deployments"
        description={
          <span className="flex items-center gap-2">
            Every `hexclave deploy`, with the services it shipped.
            {stageLabel != null && <DesignBadge label={stageLabel} color="purple" size="sm" />}
          </span>
        }
      >
        {openRun !== null ? (
          <DeploymentDetailContent run={openRun} project={project} onBack={() => setOpenRun(null)} />
        ) : (
          // flex-1 + min-h-0 are load-bearing: BoardCanvas is absolutely
          // positioned inside a `flex-1` root, so a content-sized wrapper
          // collapses the whole Services tab to zero height.
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex shrink-0 gap-0.5 border-b border-border/60">
              {([["deployments", "Deployments"], ["services", "Services"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={
                    "relative shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors duration-150 "
                    + (tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {label}
                  {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
            {/* The service board keeps its own detail panel (variables, domains,
                settings) — it is the place to inspect a service's current
                configuration, as opposed to what one deploy did to it. The
                deployments list is content-sized and scrolls with the page; the
                board needs the definite height the wrapper above provides. */}
            {tab === "deployments"
              ? <div className="min-h-0 flex-1 overflow-y-auto"><DeploymentsList project={project} onOpenRun={setOpenRun} /></div>
              : <BoardCanvas />}
          </div>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}
