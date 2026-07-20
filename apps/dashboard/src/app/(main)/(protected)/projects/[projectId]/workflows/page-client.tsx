"use client";

import { useState } from "react";
import { PageLayout } from "../page-layout";
import { WorkflowDetail } from "./workflow-detail";

// Mock UI for the upcoming Workflows app (see the Workflows v1 spec). All
// data is fake. There is deliberately no app-store registration — the
// previous Workflows app was removed in 2025-10 and a config migration still
// strips `apps.installed.workflows`, so wiring a real app id is part of the
// actual implementation, not this mock. The page is reachable via the
// "Workflows" sidebar entry.

export default function PageClient() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

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
