import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  DotsThreeVerticalIcon,
  EnvelopeSimpleIcon,
  PauseIcon,
  PlayIcon,
  ProhibitIcon,
} from "@phosphor-icons/react"
import type { AdminEmailOutbox } from "@stackframe/tanstack-start"

import type { VirtualDataGridColumn } from "@/components/ui/virtual-data-grid"
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
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ProjectDetailSheet } from "@/components/console/project-detail-sheet"
import { PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS } from "@/components/console/project-page"
import { VirtualDataGrid } from "@/components/ui/virtual-data-grid"
import { useInfiniteListQuery } from "@/hooks/use-infinite-virtual-list"

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

const OUTBOX_ROW_HEIGHT = 52
const OUTBOX_TABLE_FRAME_CLASS =
  "rounded-lg border [clip-path:inset(0_round_var(--radius-lg))]"

export const Route = createFileRoute("/_app/projects/$projectId/emails/outbox")(
  {
    component: OutboxPage,
  }
)

function OutboxPage() {
  const adminApp = useAdminApp()
  const projectId = useProjectId()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)

  const simpleStatus = SIMPLE_STATUS_BY_FILTER[statusFilter]
  const statusFilterSwitcher = (
    <StatusFilterSwitcher
      value={statusFilter}
      onValueChange={setStatusFilter}
    />
  )
  const hasActiveFilter = search.trim().length > 0 || statusFilter !== "all"

  const {
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteListQuery<AdminEmailOutbox, string>({
    queryKey: ["outboxEmails", projectId, statusFilter] as const,
    queryFn: async ({ pageParam }) => {
      const result = await adminApp.listOutboxEmails({
        limit: PAGE_SIZE,
        cursor: pageParam,
        ...(simpleStatus == null ? {} : { simpleStatus }),
      })
      return { items: result.items, nextCursor: result.nextCursor }
    },
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
      if (
        row.to.type === "custom-emails" ||
        row.to.type === "user-custom-emails"
      ) {
        return row.to.emails.some((e) => e.toLowerCase().includes(q))
      }
      return row.to.userId.toLowerCase().includes(q)
    })
  }, [items, search, statusFilter])

  const selected =
    selectedId == null
      ? null
      : (items.find((row) => row.id === selectedId) ?? null)

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["outboxEmails", projectId],
    })
  }

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => await adminApp.pauseOutboxEmail(id),
    onSuccess: async () => {
      toast.success("Email paused")
      await invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to pause email")
    },
  })

  const unpauseMutation = useMutation({
    mutationFn: async (id: string) => await adminApp.unpauseOutboxEmail(id),
    onSuccess: async () => {
      toast.success("Email resumed")
      await invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to resume email")
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => await adminApp.cancelOutboxEmail(id),
    onSuccess: async () => {
      toast.success("Email cancelled")
      await invalidate()
      setSelectedId(null)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to cancel email")
    },
  })
  const columns = useOutboxColumns({
    onSelect: (row) => setSelectedId(row.id),
    onPause: (id) => pauseMutation.mutate(id),
    onUnpause: (id) => unpauseMutation.mutate(id),
    onRequestCancel: setConfirmCancelId,
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <VirtualDataGrid
            columns={columns}
            items={[]}
            getItemKey={(row) => row.id}
            rowHeight={OUTBOX_ROW_HEIGHT}
            isLoading
            hasNextPage={false}
            isFetchingNextPage={false}
            fetchNextPage={() => {}}
            searchValue={search}
            onSearchValueChange={setSearch}
            searchPlaceholder="Search by recipient"
            headerAccessory={statusFilterSwitcher}
            isSearching={hasActiveFilter}
            emptyMessage=""
            frameClassName={`min-h-0 flex-1 overflow-hidden ${OUTBOX_TABLE_FRAME_CLASS}`}
            stickyTopClassName={PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS}
            scrollMode="container"
          />
        ) : isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load outbox."}
          </p>
        ) : items.length === 0 && !hasActiveFilter ? (
          <OutboxEmpty />
        ) : (
          <VirtualDataGrid
            columns={columns}
            items={filtered}
            getItemKey={(row) => row.id}
            rowHeight={OUTBOX_ROW_HEIGHT}
            isLoading={false}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            searchValue={search}
            onSearchValueChange={setSearch}
            searchPlaceholder="Search by recipient"
            headerAccessory={statusFilterSwitcher}
            isSearching={hasActiveFilter}
            emptyMessage="No emails match the current filters."
            selectedItemKey={selectedId}
            onSelectItemKey={setSelectedId}
            frameClassName={`min-h-0 flex-1 overflow-hidden ${OUTBOX_TABLE_FRAME_CLASS}`}
            stickyTopClassName={PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS}
            scrollMode="container"
          />
        )}
      </div>

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

function StatusFilterSwitcher({
  value,
  onValueChange,
}: {
  value: StatusFilter
  onValueChange: (nextStatusFilter: StatusFilter) => void
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(nextValues) => {
        const nextValue = nextValues[0]
        if (
          nextValue === "all" ||
          nextValue === "pending" ||
          nextValue === "paused" ||
          nextValue === "failed"
        ) {
          onValueChange(nextValue)
        }
      }}
      variant="outline"
      size="sm"
      aria-label="Filter outgoing emails by status"
    >
      <ToggleGroupItem value="all" aria-label="Show all emails">
        All
      </ToggleGroupItem>
      <ToggleGroupItem value="pending" aria-label="Show pending emails">
        Pending
      </ToggleGroupItem>
      <ToggleGroupItem value="paused" aria-label="Show paused emails">
        Paused
      </ToggleGroupItem>
      <ToggleGroupItem value="failed" aria-label="Show failed emails">
        Failed
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

function useOutboxColumns({
  onSelect,
  onPause,
  onUnpause,
  onRequestCancel,
}: {
  onSelect: (row: AdminEmailOutbox) => void
  onPause: (id: string) => void
  onUnpause: (id: string) => void
  onRequestCancel: (id: string) => void
}) {
  return useMemo<Array<VirtualDataGridColumn<AdminEmailOutbox, string>>>(
    () => [
      {
        id: "recipient",
        label: "Recipient",
        width: "minmax(0,1.2fr)",
        renderCell: (row) => (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSelect(row)
            }}
            className="block min-w-0 truncate text-left font-mono text-xs text-inherit"
          >
            {recipientLabel(row)}
          </button>
        ),
      },
      {
        id: "subject",
        label: "Subject",
        width: "minmax(0,1.4fr)",
        renderCell: (row) => (
          <span className="block min-w-0 truncate text-sm">
            {subjectOf(row) ?? "-"}
          </span>
        ),
      },
      {
        id: "status",
        label: "Status",
        width: "minmax(0,0.75fr)",
        renderCell: (row) => (
          <StatusBadge status={row.status} simpleStatus={row.simpleStatus} />
        ),
      },
      {
        id: "scheduled",
        label: "Scheduled",
        width: "minmax(0,0.9fr)",
        renderCell: (row) => (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {formatShortDate(row.scheduledAt)}
          </span>
        ),
      },
      {
        id: "actions",
        label: "Actions",
        width: "3.5rem",
        headerClassName: "justify-end",
        cellClassName: "justify-end",
        renderCell: (row) => {
          const canPause =
            row.status !== "paused" && row.simpleStatus === "in-progress"
          const canUnpause = row.status === "paused"
          const canCancel = row.simpleStatus === "in-progress"
          return (
            <div onClick={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Row actions"
                    >
                      <DotsThreeVerticalIcon />
                    </Button>
                  }
                />
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
          )
        },
      },
    ],
    [onPause, onRequestCancel, onSelect, onUnpause]
  )
}

function StatusBadge({
  status,
  simpleStatus,
}: {
  status: AdminEmailOutbox["status"]
  simpleStatus: AdminEmailOutbox["simpleStatus"]
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
  email: AdminEmailOutbox | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onPause: (id: string) => void
  onUnpause: (id: string) => void
  onRequestCancel: (id: string) => void
}) {
  return (
    <ProjectDetailSheet open={open} onOpenChange={onOpenChange}>
      {email == null ? null : (
        <>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <EnvelopeSimpleIcon className="size-4" />
              <span className="truncate">
                {subjectOf(email) ?? "(no subject)"}
              </span>
            </SheetTitle>
            <SheetDescription>{recipientLabel(email)}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
            <section className="space-y-3">
              <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Status
              </h3>
              <DetailRow label="Status">
                <StatusBadge
                  status={email.status}
                  simpleStatus={email.simpleStatus}
                />
              </DetailRow>
              <DetailRow label="Scheduled">
                <span className="text-sm">
                  {formatLongDate(email.scheduledAt)}
                </span>
              </DetailRow>
              <DetailRow label="Created">
                <span className="text-sm">
                  {formatLongDate(email.createdAt)}
                </span>
              </DetailRow>
              <DetailRow label="Retries">
                <span className="text-sm">{email.sendRetries}</span>
              </DetailRow>
              {email.status === "render-error" ? (
                <DetailRow label="Render error">
                  <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                    {email.renderError}
                  </pre>
                </DetailRow>
              ) : null}
              {email.status === "server-error" ? (
                <DetailRow label="Server error">
                  <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
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
                {email.status !== "paused" &&
                email.simpleStatus === "in-progress" ? (
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
    </ProjectDetailSheet>
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
  label: string
  children: React.ReactNode
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
