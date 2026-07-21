"use client";

import { useUser } from "@hexclave/next";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { useRouter } from "@/components/router";
import { usePathname } from "next/navigation";
import { PageLayout } from "../page-layout";
import { useProjectId } from "../use-admin-app";
import { WorkflowDetail } from "./workflow-detail";

// The Workflows page (v1, internal-only rollout). Deliberately NOT a
// registered dashboard app: workflows is a standalone page pinned to the top
// of the left sidebar, shown only for the internal project — which also
// sidesteps the old workflows app id being blocked by a config migration.
// The backend enforces the same gate (404) on every workflows route, so this
// client-side check is UX, not security.

export default function PageClient() {
  const projectId = useProjectId();
  useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const pathname = usePathname();
  const router = useRouter();
  const workflowsMarker = "/workflows/";
  const markerIndex = pathname.indexOf(workflowsMarker);
  const selectedWorkflowId = markerIndex === -1
    ? null
    : decodeURIComponent(pathname.slice(markerIndex + workflowsMarker.length).split("/")[0]);

  if (projectId !== "internal") {
    return null;
  }

  return (
    <PageLayout title="Workflows">
      <WorkflowDetail
        selectedWorkflowId={selectedWorkflowId}
        onSelect={(workflowId) => router.push(urlString`/projects/${projectId}/workflows/${workflowId}`)}
        onCreateDraft={(workflowId) => router.push(urlString`/projects/${projectId}/workflows/${workflowId}?tab=code&new=1`)}
        onClose={() => router.push(urlString`/projects/${projectId}/workflows`)}
      />
    </PageLayout>
  );
}
