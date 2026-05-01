import { createFileRoute } from "@tanstack/react-router"

import { ReplayPlayer } from "@/components/projects/session-replays/replay-player"

export const Route = createFileRoute(
  "/_app/projects/$projectId/session-replays/$sessionId"
)({
  component: SessionReplayPlayerRoute,
})

function SessionReplayPlayerRoute() {
  const { projectId, sessionId } = Route.useParams()
  return (
    <div className="flex h-[calc(100vh-52px)] min-h-[520px] w-full min-w-0 flex-col">
      <ReplayPlayer projectId={projectId} sessionId={sessionId} />
    </div>
  )
}
