import { createFileRoute } from "@tanstack/react-router"

import { ProjectPage, ProjectPageHeader } from "@/components/console/project-page"

export const Route = createFileRoute("/_app/projects/$projectId/dashboards")({
  component: DashboardsPage,
})

function DashboardsPage() {
  return (
    <ProjectPage>
      <ProjectPageHeader title="Dashboards" />
    </ProjectPage>
  )
}
