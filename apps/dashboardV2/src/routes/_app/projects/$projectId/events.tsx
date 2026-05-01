import { createFileRoute } from "@tanstack/react-router"

import { ProjectPage, ProjectPageHeader } from "@/components/console/project-page"

export const Route = createFileRoute("/_app/projects/$projectId/events")({
  component: EventsPage,
})

function EventsPage() {
  return (
    <ProjectPage>
      <ProjectPageHeader title="Events" />
    </ProjectPage>
  )
}
