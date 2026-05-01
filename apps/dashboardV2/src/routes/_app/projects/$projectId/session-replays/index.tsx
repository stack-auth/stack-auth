import { useMemo } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { FilmReelIcon } from "@phosphor-icons/react"

import type { VirtualDataGridColumn } from "@/components/ui/virtual-data-grid"
import { useAdminApp } from "@/lib/stack/admin-app"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  PROJECT_PAGE_HEADER_STICKY_TOP_CLASS,
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { ProjectUserDrawerLink } from "@/components/console/project-entity-drawer-link"
import { VirtualDataGrid } from "@/components/ui/virtual-data-grid"
import { useInfiniteListQuery } from "@/hooks/use-infinite-virtual-list"

const PAGE_SIZE = 25
const SESSION_REPLAY_QUERY_GC_TIME_MS = 2 * 60 * 1000

export const Route = createFileRoute(
  "/_app/projects/$projectId/session-replays/"
)({
  component: SessionReplaysIndex,
})

type SessionReplayItem = Awaited<
  ReturnType<ReturnType<typeof useAdminApp>["listSessionReplays"]>
>["items"][number]

const ROW_ESTIMATE_SIZE = 52

const SESSION_REPLAYS_TABLE_FRAME_CLASS =
  "rounded-lg border [clip-path:inset(0_round_var(--radius-lg))]"

function SessionReplaysIndex() {
  const adminApp = useAdminApp()
  const navigate = useNavigate()

  const queryKey = useMemo(
    () => ["session-replays", adminApp.projectId] as const,
    [adminApp.projectId]
  )

  const {
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteListQuery<SessionReplayItem, string>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await adminApp.listSessionReplays({
        limit: PAGE_SIZE,
        cursor: pageParam,
      })
      return { items: page.items, nextCursor: page.nextCursor }
    },
    gcTime: SESSION_REPLAY_QUERY_GC_TIME_MS,
  })

  const showCount = !isLoading && !isError
  const columns = useSessionReplayColumns()

  return (
    <ProjectPage>
      <ProjectPageHeader
        title="Session replays"
        badge={
          showCount ? (
            <Badge variant="secondary">{items.length.toLocaleString()}</Badge>
          ) : null
        }
      />

      <ProjectPageMain>
        {isLoading ? (
          <VirtualDataGrid
            columns={columns}
            items={[]}
            getItemKey={(item) => item.id}
            rowHeight={ROW_ESTIMATE_SIZE}
            isLoading
            hasNextPage={false}
            isFetchingNextPage={false}
            fetchNextPage={() => {}}
            isSearching={false}
            emptyMessage=""
            frameClassName={SESSION_REPLAYS_TABLE_FRAME_CLASS}
            stickyTopClassName={PROJECT_PAGE_HEADER_STICKY_TOP_CLASS}
          />
        ) : isError ? (
          <SessionReplaysUnavailable
            message={
              error instanceof Error
                ? error.message
                : "Unknown error loading session replays."
            }
            onRetry={() => refetch()}
          />
        ) : items.length === 0 ? (
          <SessionReplaysEmpty />
        ) : (
          <VirtualDataGrid
            columns={columns}
            items={items}
            getItemKey={(item) => item.id}
            rowHeight={ROW_ESTIMATE_SIZE}
            isLoading={false}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            isSearching={false}
            emptyMessage="No session replays yet."
            onRowClick={(item) => {
              void navigate({
                to: "/projects/$projectId/session-replays/$sessionId",
                params: {
                  projectId: adminApp.projectId,
                  sessionId: item.id,
                },
              })
            }}
            frameClassName={SESSION_REPLAYS_TABLE_FRAME_CLASS}
            stickyTopClassName={PROJECT_PAGE_HEADER_STICKY_TOP_CLASS}
          />
        )}
      </ProjectPageMain>
    </ProjectPage>
  )
}

function useSessionReplayColumns() {
  return useMemo<Array<VirtualDataGridColumn<SessionReplayItem, string>>>(
    () => [
      {
        id: "session",
        label: "Session",
        width: "minmax(0,1fr)",
        renderCell: (item) => (
          <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {item.id.slice(0, 8)}
          </code>
        ),
      },
      {
        id: "user",
        label: "User",
        width: "minmax(0,1.4fr)",
        renderCell: (item) => <UserCell user={item.projectUser} />,
      },
      {
        id: "started",
        label: "Started",
        width: "minmax(0,1.35fr)",
        renderCell: (item) => (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {formatLongDate(item.startedAt)}
          </span>
        ),
      },
      {
        id: "last-event",
        label: "Last event",
        width: "minmax(0,1.35fr)",
        renderCell: (item) => (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {formatLongDate(item.lastEventAt)}
          </span>
        ),
      },
      {
        id: "duration",
        label: "Duration",
        width: "minmax(0,0.8fr)",
        renderCell: (item) => (
          <span className="min-w-0 truncate text-sm">
            {formatDuration(
              item.lastEventAt.getTime() - item.startedAt.getTime()
            )}
          </span>
        ),
      },
      {
        id: "events",
        label: "Events",
        width: "minmax(0,0.6fr)",
        headerClassName: "justify-end",
        cellClassName: "justify-end",
        renderCell: (item) => (
          <span className="min-w-0 truncate text-right font-mono text-xs">
            {item.eventCount.toLocaleString()}
          </span>
        ),
      },
      {
        id: "chunks",
        label: "Chunks",
        width: "minmax(0,0.6fr)",
        headerClassName: "justify-end",
        cellClassName: "justify-end",
        renderCell: (item) => (
          <span className="min-w-0 truncate text-right font-mono text-xs">
            {item.chunkCount.toLocaleString()}
          </span>
        ),
      },
    ],
    []
  )
}

function UserCell({
  user,
}: {
  user: SessionReplayItem["projectUser"]
}) {
  const label = user.displayName ?? user.primaryEmail ?? user.id.slice(0, 8)
  return (
    <ProjectUserDrawerLink
      userId={user.id}
      className="text-sm underline-offset-2 hover:underline"
    >
      {label}
    </ProjectUserDrawerLink>
  )
}

function SessionReplaysEmpty() {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilmReelIcon />
          </EmptyMedia>
          <EmptyTitle>No session replays yet</EmptyTitle>
          <EmptyDescription>
            Once your app starts recording sessions, they'll show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

function SessionReplaysUnavailable({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilmReelIcon />
          </EmptyMedia>
          <EmptyTitle>Session replays unavailable</EmptyTitle>
          <EmptyDescription>
            Session replays may not be enabled for this project, or the API
            returned an error:{" "}
            <span className="font-mono text-[11px]">{message}</span>
          </EmptyDescription>
        </EmptyHeader>
        {onRetry ? (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : null}
      </Empty>
    </div>
  )
}

function formatLongDate(date: Date | null): string {
  if (date == null) return "—"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—"
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
