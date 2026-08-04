"use client";

import { DesignBadge } from "@/components/design-components";
import { getAppStageLabel } from "@/lib/apps-utils";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { BoardCanvas } from "./board-canvas";

const stageLabel = getAppStageLabel("deployments-alpha");

export default function PageClient() {
  return (
    <AppEnabledGuard appId="deployments-alpha">
      <PageLayout
        fillWidth
        title="Deployments"
        description={
          <span className="flex items-center gap-2">
            Drag services around the board and wire outputs from one into another&apos;s variables.
            {stageLabel != null && <DesignBadge label={stageLabel} color="purple" size="sm" />}
          </span>
        }
      >
        <BoardCanvas />
      </PageLayout>
    </AppEnabledGuard>
  );
}
