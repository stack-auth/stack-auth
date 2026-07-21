"use client";

import { useUser } from "@hexclave/next";
import { useState } from "react";
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
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  if (projectId !== "internal") {
    return null;
  }

  return (
    <PageLayout title="Workflows">
      <WorkflowDetail
        selectedWorkflowId={selectedWorkflowId}
        onSelect={setSelectedWorkflowId}
        onClose={() => setSelectedWorkflowId(null)}
      />
    </PageLayout>
  );
}
