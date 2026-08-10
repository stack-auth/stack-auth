"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { getAppStageLabel } from "@/lib/apps-utils";
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
  // Null = the deployment list. Opening a deployment swaps the whole page for
  // its service map rather than nesting the map inside a tab, so the map keeps
  // the full height it needs (its contents are absolutely positioned).
  const [openDeployment, setOpenDeployment] = useState<AdminDeploymentJson | null>(null);

  return (
    <AppEnabledGuard appId="deployments-alpha">
      <PageLayout
        fillWidth
        title="Deployments"
        // No prose subheader — the list says what it is. The stage badge stays
        // because it is the only thing marking the app as alpha.
        description={stageLabel == null ? undefined : <DesignBadge label={stageLabel} color="purple" size="sm" />}
      >
        {openDeployment === null ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DeploymentsList project={project} onOpenDeployment={setOpenDeployment} />
          </div>
        ) : (
          // flex-1 + min-h-0 are load-bearing: BoardCanvas is absolutely
          // positioned inside a `flex-1` root, so a content-sized wrapper
          // would collapse the whole map to zero height.
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 items-center gap-3">
              <DesignButton variant="ghost" size="sm" onClick={() => setOpenDeployment(null)}>
                <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
                Deployments
              </DesignButton>
              {/* Deployments have no user-facing number, so the timestamp is
                  what tells the reader which one they opened. */}
              <span className="truncate text-sm text-muted-foreground">
                {formatDeploymentTime(openDeployment.created_at_millis)}
              </span>
            </div>
            <BoardCanvas />
          </div>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}
