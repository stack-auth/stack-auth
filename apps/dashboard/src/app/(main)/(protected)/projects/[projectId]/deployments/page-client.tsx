"use client";

import { DesignBadge } from "@/components/design-components";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { BoardCanvas } from "./board-canvas";

export default function PageClient() {
  return (
    <AppEnabledGuard appId="deployments">
      <PageLayout
        fillWidth
        title="Deployments"
        description={
          <span className="flex items-center gap-2">
            Drag services around the board and wire outputs from one into another&apos;s variables.
            <DesignBadge label="Alpha" color="purple" size="sm" />
          </span>
        }
      >
        <BoardCanvas />
      </PageLayout>
    </AppEnabledGuard>
  );
}
