import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  FilmReelIcon,
  InfoIcon,
} from "@phosphor-icons/react"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"

import { cn } from "@/lib/utils"
import { useAdminApp } from "@/lib/stack/admin-app"
import { useInfiniteVirtualList } from "@/hooks/use-infinite-virtual-list"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"

const PAGE_SIZE = 25
const EVENT_PAGE_SIZE = 50
const SESSION_REPLAY_QUERY_GC_TIME_MS = 2 * 60 * 1000

export const Route = createFileRoute("/_app/projects/$projectId/session-replays")({
  component: SessionReplaysPage,
})

// ──────────────────────────────────────────────────────────────────────────
// Index view
// ──────────────────────────────────────────────────────────────────────────

type SessionReplayItem = Awaited<
  ReturnType<ReturnType<typeof useAdminApp>["listSessionReplays"]>
>["items"][number]

const ROW_ESTIMATE_SIZE = 52

const COLUMN_GRID_CLASS =
  "grid grid-cols-[minmax(7rem,1fr)_minmax(8rem,1.4fr)_minmax(10rem,1.4fr)_minmax(10rem,1.4fr)_minmax(5rem,0.8fr)_minmax(4rem,0.6fr)_minmax(4rem,0.6fr)] items-center gap-3 px-3"

function SessionReplaysPage() {
  const adminApp = useAdminApp()
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  const queryKey = useMemo(
    () => ["session-replays", adminApp.projectId] as const,
    [adminApp.projectId],
  )

  const {
    parentRef,
    virtualizer,
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteVirtualList<SessionReplayItem, string>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await adminApp.listSessionReplays({
        limit: PAGE_SIZE,
        cursor: pageParam,
      })
      return { items: page.items, nextCursor: page.nextCursor }
    },
    estimateSize: ROW_ESTIMATE_SIZE,
    gcTime: SESSION_REPLAY_QUERY_GC_TIME_MS,
  })

  const totalCount = items.length + (hasNextPage ? 1 : 0)
  const virtualItems = virtualizer.getVirtualItems()
  const showCount = !isLoading && !isError

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between gap-3 px-6">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-base font-semibold tracking-tight">
              Session replays
            </h1>
            {showCount ? (
              <Badge variant="secondary">{items.length.toLocaleString()}</Badge>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {isLoading ? (
          <SessionReplaysTableSkeleton />
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
          <div className="overflow-hidden rounded-lg border">
            <div
              className={cn(
                COLUMN_GRID_CLASS,
                "h-10 border-b bg-muted/30 font-mono text-[10px] tracking-wider text-muted-foreground uppercase",
              )}
            >
              <span>Session</span>
              <span>User</span>
              <span>Started</span>
              <span>Last event</span>
              <span>Duration</span>
              <span className="text-right">Events</span>
              <span className="text-right">Chunks</span>
            </div>
            <div
              ref={parentRef}
              className="relative h-[calc(100vh-14rem)] overflow-auto"
            >
              <div
                className="relative w-full"
                style={{ height: `${virtualizer.getTotalSize()}px` }}
              >
                {virtualItems.map((row) => {
                  const isLoaderRow = row.index >= items.length
                  const item = isLoaderRow ? null : items[row.index]
                  return (
                    <div
                      key={isLoaderRow ? `__loader_${row.index}` : item!.id}
                      data-index={row.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full"
                      style={{ transform: `translateY(${row.start}px)` }}
                    >
                      {isLoaderRow ? (
                        <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                          {isFetchingNextPage || hasNextPage
                            ? "Loading more…"
                            : null}
                        </div>
                      ) : (
                        <SessionReplayRow
                          item={item!}
                          projectId={adminApp.projectId}
                          onSelect={setSelectedSessionId}
                          rowCount={totalCount}
                          rowIndex={row.index}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      <SessionReplayDetailSheet
        sessionId={selectedSessionId}
        open={selectedSessionId != null}
        onOpenChange={(o) => {
          if (!o) setSelectedSessionId(null)
        }}
      />
    </div>
  )
}

function SessionReplayRow({
  item,
  projectId,
  onSelect,
  rowCount,
  rowIndex,
}: {
  item: SessionReplayItem,
  projectId: string,
  onSelect: (sessionId: string) => void,
  rowCount: number,
  rowIndex: number,
}) {
  const durationMs = item.lastEventAt.getTime() - item.startedAt.getTime()
  const isLast = rowIndex === rowCount - 1
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect(item.id)
        }
      }}
      className={cn(
        COLUMN_GRID_CLASS,
        "min-h-[52px] cursor-pointer text-sm transition-colors hover:bg-muted/50 hover:transition-none",
        !isLast && "border-b",
      )}
    >
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {item.id.slice(0, 8)}
      </code>
      <UserCell projectId={projectId} user={item.projectUser} />
      <span className="truncate text-sm text-muted-foreground">
        {formatLongDate(item.startedAt)}
      </span>
      <span className="truncate text-sm text-muted-foreground">
        {formatLongDate(item.lastEventAt)}
      </span>
      <span className="text-sm">{formatDuration(durationMs)}</span>
      <span className="text-right font-mono text-xs">
        {item.eventCount.toLocaleString()}
      </span>
      <span className="text-right font-mono text-xs">
        {item.chunkCount.toLocaleString()}
      </span>
    </div>
  )
}

function UserCell({
  projectId,
  user,
}: {
  projectId: string,
  user: SessionReplayItem["projectUser"],
}) {
  const label = user.displayName ?? user.primaryEmail ?? user.id.slice(0, 8)
  return (
    <Link
      to="/projects/$projectId/users"
      params={{ projectId }}
      onClick={(e) => e.stopPropagation()}
      className="text-sm underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  )
}

function SessionReplaysTableSkeleton() {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
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
  message: string,
  onRetry?: () => void,
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
            Session replays may not be enabled for this project, or the API returned
            an error: <span className="font-mono text-[11px]">{message}</span>
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

// ──────────────────────────────────────────────────────────────────────────
// Detail viewer
// ──────────────────────────────────────────────────────────────────────────

function SessionReplayDetailSheet({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {sessionId == null ? null : <SessionReplayDetail sessionId={sessionId} />}
      </SheetContent>
    </Sheet>
  )
}

function SessionReplayDetail({ sessionId }: { sessionId: string }) {
  const adminApp = useAdminApp()
  const [offset, setOffset] = useState(0)

  // We need session metadata. The SDK doesn't expose a single-session getter, so we
  // re-use the cached list result if present, but fall back to a tiny direct fetch
  // for context (just the chunks endpoint) so the sheet still works after a refresh.
  const eventsQuery = useQuery({
    queryKey: ["session-replay-events", adminApp.projectId, sessionId, offset, EVENT_PAGE_SIZE],
    queryFn: () =>
      adminApp.getSessionReplayEvents(sessionId, {
        offset,
        limit: EVENT_PAGE_SIZE,
      }),
    gcTime: SESSION_REPLAY_QUERY_GC_TIME_MS,
  })

  const events = useMemo(() => flattenEvents(eventsQuery.data?.chunkEvents ?? []), [eventsQuery.data])
  const totalEventCount = useMemo(
    () => (eventsQuery.data?.chunks ?? []).reduce((acc, c) => acc + c.eventCount, 0),
    [eventsQuery.data],
  )
  const firstEventAt = useMemo(() => {
    const chunks = eventsQuery.data?.chunks ?? []
    if (chunks.length === 0) return null
    return chunks.reduce<Date>(
      (min, c) => (c.firstEventAt < min ? c.firstEventAt : min),
      chunks[0]?.firstEventAt ?? throwErr("Unexpected: no first chunk"),
    )
  }, [eventsQuery.data])
  const lastEventAt = useMemo(() => {
    const chunks = eventsQuery.data?.chunks ?? []
    if (chunks.length === 0) return null
    return chunks.reduce<Date>(
      (max, c) => (c.lastEventAt > max ? c.lastEventAt : max),
      chunks[0]?.lastEventAt ?? throwErr("Unexpected: no first chunk"),
    )
  }, [eventsQuery.data])

  const baseTimestamp = useMemo(() => {
    if (events.length === 0) return null
    const ts = readTimestamp(events[0].event)
    return ts ?? (firstEventAt != null ? firstEventAt.getTime() : null)
  }, [events, firstEventAt])

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <FilmReelIcon className="size-4" />
          Session replay
        </SheetTitle>
        <SheetDescription>
          <CopyableId value={sessionId} />
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
        <Alert>
          <InfoIcon />
          <AlertTitle>Visual playback isn't enabled in this build.</AlertTitle>
          <AlertDescription>
            Showing raw rrweb events. To enable visual playback, install{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              rrweb-player
            </code>
            .
          </AlertDescription>
        </Alert>

        <section className="space-y-3">
          <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Metadata
          </h3>
          <DetailRow label="Started">
            <span className="text-sm">{formatLongDate(firstEventAt)}</span>
          </DetailRow>
          <DetailRow label="Last event">
            <span className="text-sm">{formatLongDate(lastEventAt)}</span>
          </DetailRow>
          <DetailRow label="Duration">
            <span className="text-sm">
              {firstEventAt != null && lastEventAt != null
                ? formatDuration(lastEventAt.getTime() - firstEventAt.getTime())
                : "—"}
            </span>
          </DetailRow>
          <DetailRow label="Total events">
            <span className="font-mono text-xs">{totalEventCount.toLocaleString()}</span>
          </DetailRow>
          <DetailRow label="Chunks">
            <span className="font-mono text-xs">
              {(eventsQuery.data?.chunks ?? []).length.toLocaleString()}
            </span>
          </DetailRow>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Events
            </h3>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{offset + events.length}
            </span>
          </div>

          {eventsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : eventsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Failed to load events</AlertTitle>
              <AlertDescription>
                {eventsQuery.error instanceof Error
                  ? eventsQuery.error.message
                  : "Unknown error."}
              </AlertDescription>
            </Alert>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No events on this page.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {events.map((entry, idx) => (
                <EventRow
                  key={`${entry.chunkId}-${offset + idx}`}
                  index={offset + idx}
                  event={entry.event}
                  baseTimestamp={baseTimestamp}
                />
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - EVENT_PAGE_SIZE))}
            >
              <CaretLeftIcon />
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={events.length < EVENT_PAGE_SIZE}
              onClick={() => setOffset((o) => o + EVENT_PAGE_SIZE)}
            >
              Next
              <CaretRightIcon />
            </Button>
          </div>
        </section>
      </div>
    </>
  )
}

type FlatEvent = { chunkId: string, event: unknown }

function flattenEvents(
  chunkEvents: ReadonlyArray<{ chunkId: string, events: Array<unknown> }>,
): Array<FlatEvent> {
  const result: Array<FlatEvent> = []
  for (const c of chunkEvents) {
    for (const event of c.events) {
      result.push({ chunkId: c.chunkId, event })
    }
  }
  return result
}

function EventRow({
  index,
  event,
  baseTimestamp,
}: {
  index: number,
  event: unknown,
  baseTimestamp: number | null,
}) {
  const timestamp = readTimestamp(event)
  const relative =
    timestamp != null && baseTimestamp != null
      ? formatRelative(timestamp - baseTimestamp)
      : null
  const label = describeEvent(event)

  return (
    <li className="px-3 py-2">
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-3 list-none">
          <span className="w-10 shrink-0 font-mono text-[10px] text-muted-foreground">
            #{index}
          </span>
          <span className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
            {relative ?? "—"}
          </span>
          <Badge variant="secondary" className="shrink-0">
            {label}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground transition-transform group-open:rotate-90">
            <CaretRightIcon />
          </span>
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted px-2 py-1.5 font-mono text-[10px] leading-relaxed">
          {safeStringify(event)}
        </pre>
      </details>
    </li>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// rrweb event helpers
// ──────────────────────────────────────────────────────────────────────────

// rrweb event type constants. We don't depend on rrweb at runtime, so we encode
// them here. Source: https://github.com/rrweb-io/rrweb/blob/master/packages/types
const RRWEB_EVENT_TYPE_LABELS: Record<number, string> = {
  0: "DOM content loaded",
  1: "Load",
  2: "Full snapshot",
  3: "Incremental snapshot",
  4: "Meta",
  5: "Custom",
  6: "Plugin",
}

const RRWEB_INCREMENTAL_SOURCE_LABELS: Record<number, string> = {
  0: "Mutation",
  1: "Mouse move",
  2: "Mouse interaction",
  3: "Scroll",
  4: "Viewport resize",
  5: "Input",
  6: "Touch move",
  7: "Media interaction",
  8: "Style sheet rule",
  9: "Canvas mutation",
  10: "Font",
  11: "Log",
  12: "Drag",
  13: "Style declaration",
  14: "Selection",
  15: "Adopted style sheet",
  16: "Custom element",
}

function describeEvent(event: unknown): string {
  if (event == null || typeof event !== "object") return "Event"
  const obj = event as { type?: unknown, data?: unknown }
  const type = typeof obj.type === "number" ? obj.type : null
  if (type == null) return "Event"
  const baseLabel = RRWEB_EVENT_TYPE_LABELS[type] ?? `Type ${type}`
  if (type === 3 && obj.data != null && typeof obj.data === "object") {
    const source = (obj.data as { source?: unknown }).source
    if (typeof source === "number") {
      const sourceLabel = RRWEB_INCREMENTAL_SOURCE_LABELS[source] ?? `src ${source}`
      return sourceLabel
    }
  }
  return baseLabel
}

function readTimestamp(event: unknown): number | null {
  if (event == null || typeof event !== "object") return null
  const ts = (event as { timestamp?: unknown }).timestamp
  return typeof ts === "number" ? ts : null
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared bits
// ──────────────────────────────────────────────────────────────────────────

function DetailRow({
  label,
  children,
}: {
  label: string,
  children: React.ReactNode,
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span className="flex items-center gap-2 min-w-0">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={onCopy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
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

function formatRelative(ms: number): string {
  const sign = ms < 0 ? "-" : "+"
  const abs = Math.abs(ms)
  if (abs < 1000) return `${sign}${abs}ms`
  const seconds = abs / 1000
  if (seconds < 60) return `${sign}${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remSeconds = Math.floor(seconds % 60)
  return `${sign}${minutes}m${remSeconds}s`
}
