"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { getAppStageLabel } from "@/lib/apps-utils";
import { cn } from "@/components/ui";
import type { AdminDeploymentJson } from "@hexclave/next";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { BoardCanvas } from "./board-canvas";
import { DeploymentsList } from "./deployments-list";

const stageLabel = getAppStageLabel("deployments-alpha");

function formatDeploymentTime(millis: number): string {
  return new Date(millis).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  // Null = the deployment list. Opening a deployment swaps the whole page for its service
  // map rather than nesting the map in a tab, so the map keeps the full height it needs
  // (its contents are absolutely positioned).
  //
  // The ID and the object are held separately on purpose. Keeping only the object froze it:
  // the list owns the poll, and unmounting the list left the detail rendering a snapshot that
  // never updated — an in-flight deploy sat at "Building" until the user went back and
  // reopened it. The list now stays mounted (hidden) and reports the fresh copy back.
  const [openDeploymentId, setOpenDeploymentId] = useState<string | null>(null);
  const [openDeployment, setOpenDeployment] = useState<AdminDeploymentJson | null>(null);
  // Held here rather than only inside the list, because the open deployment's map is scoped
  // to a moment in time across EVERY source and needs their deployments to resolve it.
  const [deployments, setDeployments] = useState<AdminDeploymentJson[]>([]);
  const isOpen = openDeploymentId !== null && openDeployment !== null;

  return (
    <AppEnabledGuard appId="deployments-alpha">
      <PageLayout
        fillWidth
        title="Deployments"
        // No prose subheader — the list says what it is. The stage badge stays
        // because it is the only thing marking the app as alpha.
        description={stageLabel == null ? undefined : <DesignBadge label={stageLabel} color="purple" size="sm" />}
      >
        {isOpen && (
          <div className="mb-3 flex shrink-0 items-center gap-3">
            <DesignButton variant="ghost" size="sm" onClick={() => setOpenDeploymentId(null)}>
              <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
              All deployments
            </DesignButton>
            {/* Deployments have no user-facing number in the list, so the timestamp is what
                tells the reader which one they opened. */}
            <span className="truncate text-sm text-muted-foreground">
              Deployment #{openDeployment.number} · {formatDeploymentTime(openDeployment.created_at_millis)}
            </span>
          </div>
        )}

        {/* The list stays MOUNTED while a deployment is open, hidden rather than unmounted,
            because it owns the poll that keeps every deployment — including the open one — up
            to date. It reports the open deployment's current value back through
            onOpenDeploymentChange on each poll, which is what makes a running build's statuses
            advance in the map instead of freezing. */}
        <div className={cn("min-h-0 flex-1 overflow-y-auto", isOpen && "hidden")}>
          <DeploymentsList
            project={project}
            openDeploymentId={openDeploymentId}
            onOpenDeployment={(deployment) => {
              setOpenDeploymentId(deployment.id);
              setOpenDeployment(deployment);
            }}
            onOpenDeploymentChange={setOpenDeployment}
            onDeploymentsLoaded={setDeployments}
          />
        </div>

        {/* NOT wrapped in a div: BoardCanvas's root carries `flex min-h-0 flex-1` and its
            contents are absolutely positioned, so it has to be a direct child of PageLayout's
            flex column — inside a plain block wrapper the `flex-1` resolves against nothing
            and the board collapses to zero height. */}
        {isOpen && <BoardCanvas deployment={openDeployment} deployments={deployments} />}
      </PageLayout>
    </AppEnabledGuard>
  );
}
