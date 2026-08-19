"use client";

import { DesignCard } from "@/components/design-components";
import { Link } from "@/components/link";
import { FileTextIcon } from "@phosphor-icons/react";
import { PageLayout } from "../page-layout";
import { GrowthAppFrame, GrowthDemoToolbar } from "./components/frame";
import { GrowthStatusGate } from "./components/frame";
import { GrowthLifecycleTimeline } from "./components/lifecycle-panels";
import { useGrowthHref } from "./components/action-card";
import { useProjectId } from "../use-admin-app";
import { urlString } from "@hexclave/shared/dist/utils/urls";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout
        title="GTM"
        description="AI-driven analysis, actionable items, and daily briefs for growing your product"
      >
        <GrowthDemoToolbar />
        <GrowthStatusGate>
          {(status) => status.latestReport == null
            ? <GrowthLifecycleTimeline status={status} />
            : <CustomerGrowthReportEntry />}
        </GrowthStatusGate>
      </PageLayout>
    </GrowthAppFrame>
  );
}

function CustomerGrowthReportEntry() {
  const growthHref = useGrowthHref();
  const projectId = useProjectId();
  return (
    <DesignCard title="Your growth presentation" icon={FileTextIcon} gradient="default">
      <p className="text-sm leading-6 text-muted-foreground">
        Your latest growth recommendations are ready to review.
      </p>
      <Link href={growthHref(urlString`/projects/${projectId}/gtm/report`)} className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">
        View presentation
      </Link>
    </DesignCard>
  );
}
