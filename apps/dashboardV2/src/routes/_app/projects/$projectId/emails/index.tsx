import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/projects/$projectId/emails/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/projects/$projectId/emails/templates",
      params: { projectId: params.projectId },
    })
  },
})
