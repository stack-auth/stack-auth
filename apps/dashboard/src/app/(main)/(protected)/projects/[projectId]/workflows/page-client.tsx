"use client";

import { DesignBadge } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { getAppStageLabel } from "@/lib/apps-utils";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { usePathname } from "next/navigation";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";
import { WorkflowDetail } from "./workflow-detail";

// The Workflows app (alpha). Available to any project that installs
// `workflows-alpha` — note that alpha apps are hidden from the app-store
// listing outside development, so installing is currently a deliberate config
// action rather than a click. The backend enforces the same gate (404 on every
// workflows route), so the guard here is UX, not security.

const stageLabel = getAppStageLabel("workflows-alpha");

export default function PageClient() {
  const projectId = useProjectId();
  const pathname = usePathname();
  const router = useRouter();
  const workflowsMarker = "/workflows/";
  const markerIndex = pathname.indexOf(workflowsMarker);
  const selectedWorkflowId = markerIndex === -1
    ? null
    : decodeURIComponent(pathname.slice(markerIndex + workflowsMarker.length).split("/")[0]);

  return (
    <AppEnabledGuard appId="workflows-alpha">
      <PageLayout
        title="Workflows"
        description={
          <span className="flex items-center gap-2">
            Durable, code-defined automations that react to events in your project.
            {stageLabel != null && <DesignBadge label={stageLabel} color="purple" size="sm" />}
          </span>
        }
      >
        <WorkflowDetail
          selectedWorkflowId={selectedWorkflowId}
          onSelect={(workflowId) => router.push(urlString`/projects/${projectId}/workflows/${workflowId}`)}
          onCreateDraft={(workflowId) => router.push(urlString`/projects/${projectId}/workflows/${workflowId}?tab=code&new=1`)}
          onClose={() => router.push(urlString`/projects/${projectId}/workflows`)}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
