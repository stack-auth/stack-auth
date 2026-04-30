import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  DotsThreeVerticalIcon,
  EnvelopeSimpleIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  ProhibitIcon,
} from "@phosphor-icons/react"
import type { AdminEmailOutbox } from "@stackframe/tanstack-start"

import { useAdminApp, useProjectId } from "@/lib/stack/admin-app"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useInfiniteVirtualList } from "@/hooks/use-infinite-virtual-list"

const PAGE_SIZE = 25
const OUTBOX_QUERY_GC_TIME_MS = 2 * 60 * 1000

type StatusFilter = "all" | "pending" | "paused" | "failed"

// Map our UI filter onto the SDK's `simpleStatus` field where it lines up.
// "pending" => in-progress; "failed" => error; "paused" is its own status (we filter
// client-side because the SDK option is simpleStatus, and paused is in-progress).
const SIMPLE_STATUS_BY_FILTER: Record<StatusFilter, string | undefined> = {
  all: undefined,
  pending: "in-progress",
  paused: undefined,
  failed: "error",
}

const ROW_GRID = "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_120px_140px_60px] items-center gap-3 px-4"

export const Route = createFileRoute("/_app/projects/$projectId/emails/outbox")({
  component: OutboxPage,
})

function OutboxPage() {
  const adminApp = useAdminApp()
  const projectId = useProjectId()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)

  const simpleStatus = SIMPLE_STATUS_BY_FILTER[statusFilter]

  const {
    parentRef,
    virtualizer,
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
  } = useInfiniteVirtualList<AdminEmailOutbox, string>({
    queryKey: ["outboxEmails", projectId, statusFilter] as const,
    queryFn: async ({ pageParam }) => {
      const result = await adminApp.listOutboxEmails({
        limit: PAGE_SIZE,
        cursor: pageParam,
        ...(simpleStatus == null ? {} : { simpleStatus }),
      })
      return { items: result.items, nextCursor: result.nextCursor }
    },
    estimateSize: 52,
    overscan: 8,
    gcTime: OUTBOX_QUERY_GC_TIME_MS,
  })

  const filtered = useMemo(() => {
    let rows: ReadonlyArray<AdminEmailOutbox> = items
    if (statusFilter === "paused") {
      rows = rows.filter((row) => row.status === "paused")
    }
    const q = search.trim().toLowerCase()
    if (q.length === 0) return rows
    return rows.filter((row) => {
      if (row.to.type === "custom-emails" || row.to.type === "user-custom-emails") {
        return row.to.emails.some((e) => e.toLowerCase().includes(q))
      }
      return row.to.userId.toLowerCase().includes(q)
    })
  }, [items, search, statusFilter])

  const selected = selectedId == null
    ? null
    : items.find((row) => row.id === selectedId) ?? null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["outboxEmails", projectId] })
  }

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => await adminApp.pauseOutboxEmail(id),
    onSuccess: () => {
      toast.success("Email paused")
      invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to pause email")
    },
  })

  const unpauseMutation = useMutation({
    mutationFn: async (id: string) => await adminApp.unpauseOutboxEmail(id),
    onSuccess: () => {
      toast.success("Email resumed")
      invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to resume email")
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => await adminApp.cancelOutboxEmail(id),
    onSuccess: () => {
      toast.success("Email cancelled")
      invalidate()
      setSelectedId(null)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to cancel email")
    },
  })

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Outbox
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <FilterChip
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            All
          </FilterChip>
          <FilterChip
            active={statusFilter === "pending"}
            onClick={() => setStatusFilter("pending")}
          >
            Pending
          </FilterChip>
          <FilterChip
            active={statusFilter === "paused"}
            onClick={() => setStatusFilter("paused")}
          >
            Paused
          </FilterChip>
          <FilterChip
            active={statusFilter === "failed"}
            onClick={() => setStatusFilter("failed")}
          >
            Failed
          </FilterChip>

          <div className="relative ml-auto max-w-sm flex-1">
            <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by recipient"
              className="ps-8"
            />
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load outbox."}
          </p>
        ) : items.length === 0 ? (
          <OutboxEmpty />
        ) : (
          <div className="rounded-lg border">
            <div
              className={`${ROW_GRID} h-10 border-b bg-muted/30 font-mono text-[10px] tracking-wider text-muted-foreground uppercase`}
            >
              <span>Recipient</span>
              <span>Subject</span>
              <span>Status</span>
              <span>Scheduled</span>
              <span></span>
            </div>
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No emails match the current filters.
              </p>
            ) : (
              <OutboxVirtualList
                parentRef={parentRef}
                virtualizer={virtualizer}
                items={items}
                filtered={filtered}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                onSelect={(row) => setSelectedId(row.id)}
                onPause={(id) => pauseMutation.mutate(id)}
                onUnpause={(id) => unpauseMutation.mutate(id)}
                onRequestCancel={(id) => setConfirmCancelId(id)}
              />
            )}
          </div>
        )}
      </main>

      <OutboxDetailSheet
        email={selected}
        open={selected != null}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null)
        }}
        onPause={(id) => pauseMutation.mutate(id)}
        onUnpause={(id) => unpauseMutation.mutate(id)}
        onRequestCancel={(id) => setConfirmCancelId(id)}
      />

      <AlertDialog
        open={confirmCancelId != null}
        onOpenChange={(o) => {
          if (!o) setConfirmCancelId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this email?</AlertDialogTitle>
            <AlertDialogDescription>
              The email will not be sent. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>
              Keep
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (confirmCancelId == null) return
                cancelMutation.mutate(confirmCancelId)
                setConfirmCancelId(null)
              }}
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel email"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean,
  onClick: () => void,
  children: React.ReactNode,
}) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick}>
      {children}
    </Button>
  )
}

function OutboxVirtualList({
  parentRef,
  virtualizer,
  items,
  filtered,
  hasNextPage,
  isFetchingNextPage,
  onSelect,
  onPause,
  onUnpause,
  onRequestCancel,
}: {
  parentRef: React.RefObject<HTMLDivElement>,
  virtualizer: ReturnType<typeof useInfiniteVirtualList<AdminEmailOutbox, string>>["virtualizer"],
  items: ReadonlyArray<AdminEmailOutbox>,
  filtered: ReadonlyArray<AdminEmailOutbox>,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  onSelect: (row: AdminEmailOutbox) => void,
  onPause: (id: string) => void,
  onUnpause: (id: string) => void,
  onRequestCancel: (id: string) => void,
}) {
  // The virtualizer is keyed off the unfiltered `items` (so pagination works
  // against the source of truth). When client-side filtering removes rows we
  // still keep the virtual layout aligned by indexing into `items` and
  // skipping rows that aren't in the filtered set.
  const filteredIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered])
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="h-[calc(100vh-16rem)] overflow-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((row) => {
          const isLoaderRow = row.index >= items.length
          if (isLoaderRow) {
            return (
              <div
                key={`__loader_${row.index}`}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {hasNextPage || isFetchingNextPage ? (
                  <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                    Loading more…
                  </div>
                ) : null}
              </div>
            )
          }
          const item = items[row.index]
          const visible = filteredIds.has(item.id)
          return (
            <div
              key={item.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {visible ? (
                <OutboxRow
                  row={item}
                  onSelect={onSelect}
                  onPause={onPause}
                  onUnpause={onUnpause}
                  onRequestCancel={onRequestCancel}
                />
              ) : (
                <div style={{ height: 0 }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OutboxRow({
  row,
  onSelect,
  onPause,
  onUnpause,
  onRequestCancel,
}: {
  row: AdminEmailOutbox,
  onSelect: (row: AdminEmailOutbox) => void,
  onPause: (id: string) => void,
  onUnpause: (id: string) => void,
  onRequestCancel: (id: string) => void,
}) {
  const canPause = row.status !== "paused" && row.simpleStatus === "in-progress"
  const canUnpause = row.status === "paused"
  const canCancel = row.simpleStatus === "in-progress"
  return (
    <div
      className={`${ROW_GRID} h-[52px] border-b transition-colors hover:bg-muted/50 hover:transition-none`}
    >
      <button
        type="button"
        onClick={() => onSelect(row)}
        className="block w-full truncate text-left font-mono text-xs text-inherit"
      >
        {recipientLabel(row)}
      </button>
      <span className="block truncate text-sm">
        {subjectOf(row) ?? "—"}
      </span>
      <div>
        <StatusBadge status={row.status} simpleStatus={row.simpleStatus} />
      </div>
      <span className="text-sm text-muted-foreground">
        {formatShortDate(row.scheduledAt)}
      </span>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Row actions"
              />
            }
          >
            <DotsThreeVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSelect(row)}>
              <EnvelopeSimpleIcon />
              View details
            </DropdownMenuItem>
            {canPause ? (
              <DropdownMenuItem onClick={() => onPause(row.id)}>
                <PauseIcon />
                Pause
              </DropdownMenuItem>
            ) : null}
            {canUnpause ? (
              <DropdownMenuItem onClick={() => onUnpause(row.id)}>
                <PlayIcon />
                Unpause
              </DropdownMenuItem>
            ) : null}
            {canCancel ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRequestCancel(row.id)}
              >
                <ProhibitIcon />
                Cancel
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function StatusBadge({
  status,
  simpleStatus,
}: {
  status: AdminEmailOutbox["status"],
  simpleStatus: AdminEmailOutbox["simpleStatus"],
}) {
  const variant: "default" | "secondary" | "destructive" =
    simpleStatus === "error"
      ? "destructive"
      : status === "paused"
      ? "secondary"
      : simpleStatus === "ok"
      ? "default"
      : "secondary"
  return <Badge variant={variant}>{status}</Badge>
}

function OutboxEmpty() {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EnvelopeSimpleIcon />
          </EmptyMedia>
          <EmptyTitle>No outgoing emails</EmptyTitle>
          <EmptyDescription>
            Emails queued or scheduled by your project will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

function OutboxDetailSheet({
  email,
  open,
  onOpenChange,
  onPause,
  onUnpause,
  onRequestCancel,
}: {
  email: AdminEmailOutbox | null,
  open: boolean,
  onOpenChange: (o: boolean) => void,
  onPause: (id: string) => void,
  onUnpause: (id: string) => void,
  onRequestCancel: (id: string) => void,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        {email == null ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <EnvelopeSimpleIcon className="size-4" />
                <span className="truncate">{subjectOf(email) ?? "(no subject)"}</span>
              </SheetTitle>
              <SheetDescription>{recipientLabel(email)}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
              <section className="space-y-3">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Status
                </h3>
                <DetailRow label="Status">
                  <StatusBadge status={email.status} simpleStatus={email.simpleStatus} />
                </DetailRow>
                <DetailRow label="Scheduled">
                  <span className="text-sm">{formatLongDate(email.scheduledAt)}</span>
                </DetailRow>
                <DetailRow label="Created">
                  <span className="text-sm">{formatLongDate(email.createdAt)}</span>
                </DetailRow>
                <DetailRow label="Retries">
                  <span className="text-sm">{email.sendRetries}</span>
                </DetailRow>
                {email.status === "render-error" ? (
                  <DetailRow label="Render error">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                      {email.renderError}
                    </pre>
                  </DetailRow>
                ) : null}
                {email.status === "server-error" ? (
                  <DetailRow label="Server error">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                      {email.serverError}
                    </pre>
                  </DetailRow>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Body
                </h3>
                <EmailBodyFrame email={email} />
              </section>

              <section className="space-y-2">
                <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Actions
                </h3>
                <div className="flex flex-wrap gap-2">
                  {email.status !== "paused" && email.simpleStatus === "in-progress" ? (
                    <Button variant="outline" onClick={() => onPause(email.id)}>
                      <PauseIcon />
                      Pause
                    </Button>
                  ) : null}
                  {email.status === "paused" ? (
                    <Button variant="outline" onClick={() => onUnpause(email.id)}>
                      <PlayIcon />
                      Unpause
                    </Button>
                  ) : null}
                  {email.simpleStatus === "in-progress" ? (
                    <Button
                      variant="destructive"
                      onClick={() => onRequestCancel(email.id)}
                    >
                      <ProhibitIcon />
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function EmailBodyFrame({ email }: { email: AdminEmailOutbox }) {
  // Email HTML is untrusted markup. Render in a sandboxed iframe with `sandbox=""`
  // (no flags) — disables scripts, forms, popups, plugins, top-level navigation,
  // and removes same-origin so relative URLs cannot leak dashboard state.
  if (!email.hasRendered) {
    return (
      <p className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
        Email has not been rendered yet.
      </p>
    )
  }
  const html = email.html
  if (html == null) {
    return (
      <p className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
        No HTML body available.
      </p>
    )
  }
  return (
    <iframe
      title="Email body"
      srcDoc={html}
      sandbox=""
      className="h-96 w-full rounded border bg-white"
    />
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string,
  children: React.ReactNode,
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function recipientLabel(email: AdminEmailOutbox): string {
  switch (email.to.type) {
    case "custom-emails":
      return email.to.emails.join(", ")
    case "user-custom-emails":
      return `${email.to.userId} (${email.to.emails.join(", ")})`
    case "user-primary-email":
      return `user:${email.to.userId}`
  }
}

function subjectOf(email: AdminEmailOutbox): string | null {
  // The skipped variant has `subject?: string` (it's only present if rendering
  // happened before the skip). Handle it first so the narrow on `hasRendered`
  // below safely lands on a variant where subject is a definite string.
  if (email.status === "skipped") return email.subject ?? null
  if (email.hasRendered) return email.subject
  return null
}

function TableSkeleton({ rows, cols }: { rows: number, cols: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-3.5 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_row, r) => (
            <TableRow key={r}>
              {Array.from({ length: cols }).map((_cell, c) => (
                <TableCell key={c}>
                  <Skeleton className="h-4 w-full max-w-[180px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatLongDate(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
