"use client";

import { PageLayout } from "../page-layout";
import { GrowthAppFrame, GrowthDemoToolbar } from "./components/frame";
import { GrowthStatusGate } from "./components/frame";
import { GrowthLifecycleTimeline } from "./components/lifecycle-panels";
import { GrowthWorkspaceOverview } from "./components/workspace-overview";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout
        title="Growth"
        description="AI-driven analysis, actionable items, and daily briefs for growing your product"
      >
        <GrowthDemoToolbar />
        <GrowthStatusGate>
          {(status) => status.latestReport == null
            ? <GrowthLifecycleTimeline status={status} />
            : <GrowthWorkspaceOverview status={status} />}
        </GrowthStatusGate>
      </PageLayout>
    </GrowthAppFrame>
  );
}
