"use client";

import { DesignBadge } from "@/components/design-components";
import { ALL_APPS } from "@hexclave/shared/dist/apps/apps-config";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { BoardCanvas } from "./board-canvas";

// Derived from the app registry so the badge can't go stale when the app's
// stage changes there. Typed wide on purpose: the stage is a single literal at
// any given time, and narrowing would make the null check below
// "always true/false" and rot the moment the stage changes.
const STAGE_LABELS: Record<"alpha" | "beta" | "stable", string | null> = { alpha: "Alpha", beta: "Beta", stable: null };
const stageLabel = STAGE_LABELS[ALL_APPS.deployments.stage];

export default function PageClient() {
  return (
    <AppEnabledGuard appId="deployments">
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
