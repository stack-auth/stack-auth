"use client";

import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DeploymentGraph } from "./deployment-graph";

export default function PageClient() {
  const project = useAdminApp().useProject();

  return (
    <AppEnabledGuard appId="deployments">
      <PageLayout
        containedHeight
        description="Map services, credentials, databases, and public routes into a connected deployment graph."
        fillWidth
        title="Deployments"
      >
        <DeploymentGraph projectId={project.id} />
      </PageLayout>
    </AppEnabledGuard>
  );
}
