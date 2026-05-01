import { Fragment, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { EnvelopeSimpleIcon, WarningIcon } from "@phosphor-icons/react"
import type { AdminSentEmail } from "@stackframe/tanstack-start"

import type { VirtualDataGridColumn } from "@/components/ui/virtual-data-grid"
import { useAdminApp, useProjectId } from "@/lib/stack/admin-app"
import { Badge } from "@/components/ui/badge"
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
import { ProjectDetailSheet } from "@/components/console/project-detail-sheet"
import { PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS } from "@/components/console/project-page"
import { VirtualDataGrid } from "@/components/ui/virtual-data-grid"
import { ProjectUserDrawerLink } from "@/components/console/project-entity-drawer-link"
import { cn } from "@/lib/utils"

const SENT_EMAILS_QUERY_GC_TIME_MS = 2 * 60 * 1000
const SENT_EMAIL_ROW_HEIGHT = 52
const SENT_EMAIL_TABLE_FRAME_CLASS =
  "rounded-lg border [clip-path:inset(0_round_var(--radius-lg))]"
const USER_ID_RECIPIENT_PREFIX = "User ID: "

export const Route = createFileRoute("/_app/projects/$projectId/emails/sent")({
  component: SentPage,
})

function SentPage() {
  const adminApp = useAdminApp()
  const projectId = useProjectId()

  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // SDK: listSentEmails(): Promise<AdminSentEmail[]>
  // AdminSentEmail = { id, to: string[], subject, recipient, sentAt: Date, error?: unknown }
  const queryKey = ["sentEmails", projectId] as const
  const listQuery = useQuery({
    queryKey,
    queryFn: async () => await adminApp.listSentEmails(),
    gcTime: SENT_EMAILS_QUERY_GC_TIME_MS,
  })

  const items = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length === 0) return items
    return items.filter((row) => {
      if (row.recipient.toLowerCase().includes(q)) return true
      if (row.subject.toLowerCase().includes(q)) return true
      return row.to.some((e) => e.toLowerCase().includes(q))
    })
  }, [items, search])

  const selected =
    selectedId == null
      ? null
      : (items.find((row) => row.id === selectedId) ?? null)

  const columns = useSentEmailColumns({
    onSelect: (row) => setSelectedId(row.id),
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {listQuery.isPending ? (
          <VirtualDataGrid
            columns={columns}
            items={[]}
            getItemKey={(row) => row.id}
            rowHeight={SENT_EMAIL_ROW_HEIGHT}
            isLoading
            hasNextPage={false}
            isFetchingNextPage={false}
            fetchNextPage={() => {}}
            searchValue={search}
            onSearchValueChange={setSearch}
            searchPlaceholder="Search by recipient or subject"
            isSearching={search.trim().length > 0}
            emptyMessage=""
            frameClassName={`min-h-0 flex-1 overflow-hidden ${SENT_EMAIL_TABLE_FRAME_CLASS}`}
            stickyTopClassName={PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS}
            scrollMode="container"
          />
        ) : listQuery.isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Failed to load sent emails."}
          </p>
        ) : items.length === 0 ? (
          <SentEmpty />
        ) : (
          <VirtualDataGrid
            columns={columns}
            items={filtered}
            getItemKey={(row) => row.id}
            rowHeight={SENT_EMAIL_ROW_HEIGHT}
            isLoading={false}
            hasNextPage={false}
            isFetchingNextPage={false}
            fetchNextPage={() => {}}
            searchValue={search}
            onSearchValueChange={setSearch}
            searchPlaceholder="Search by recipient or subject"
            isSearching={search.trim().length > 0}
            emptyMessage="No sent emails match the current search."
            selectedItemKey={selectedId}
            onSelectItemKey={setSelectedId}
            frameClassName={`min-h-0 flex-1 overflow-hidden ${SENT_EMAIL_TABLE_FRAME_CLASS}`}
            stickyTopClassName={PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS}
            scrollMode="container"
          />
        )}
      </div>

      <SentDetailSheet
        email={selected}
        open={selected != null}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null)
        }}
      />
    </div>
  )
}

function useSentEmailColumns({
  onSelect,
}: {
  onSelect: (row: AdminSentEmail) => void
}) {
  return useMemo<Array<VirtualDataGridColumn<AdminSentEmail, string>>>(
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
            {row.recipient}
          </button>
        ),
      },
      {
        id: "subject",
        label: "Subject",
        width: "minmax(0,1.4fr)",
        renderCell: (row) => (
          <span className="block min-w-0 truncate text-sm">{row.subject}</span>
        ),
      },
      {
        id: "sent",
        label: "Sent",
        width: "minmax(0,0.9fr)",
        renderCell: (row) => (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {formatLongDate(row.sentAt)}
          </span>
        ),
      },
      {
        id: "status",
        label: "Status",
        width: "minmax(0,0.65fr)",
        renderCell: (row) => <SentStatusBadge email={row} />,
      },
    ],
    [onSelect]
  )
}

function SentStatusBadge({ email }: { email: AdminSentEmail }) {
  return email.error == null ? (
    <Badge variant="default">sent</Badge>
  ) : (
    <Badge variant="destructive">error</Badge>
  )
}

function SentEmpty() {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EnvelopeSimpleIcon />
          </EmptyMedia>
          <EmptyTitle>No sent emails yet</EmptyTitle>
          <EmptyDescription>
            Emails delivered by your project will appear here once they're sent.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

function SentDetailSheet({
  email,
  open,
  onOpenChange,
}: {
  email: AdminSentEmail | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <ProjectDetailSheet open={open} onOpenChange={onOpenChange}>
      {email == null ? null : (
        <>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <EnvelopeSimpleIcon className="size-4" />
              <span className="truncate">{email.subject}</span>
            </SheetTitle>
            <SheetDescription>{email.recipient}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
            <section className="space-y-3">
              <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Metadata
              </h3>
              <DetailRow label="Recipient">
                <RecipientBacklink value={email.recipient} />
              </DetailRow>
              <DetailRow label="To">
                <RecipientBacklinkList values={email.to} />
              </DetailRow>
              <DetailRow label="Sent at">
                <span className="text-sm">{formatLongDate(email.sentAt)}</span>
              </DetailRow>
              <DetailRow label="Status">
                {email.error == null ? (
                  <Badge variant="default">sent</Badge>
                ) : (
                  <Badge variant="destructive">error</Badge>
                )}
              </DetailRow>
            </section>

            {email.error == null ? null : (
              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-destructive uppercase">
                  <WarningIcon className="size-3" />
                  Error
                </h3>
                <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                  {formatError(email.error)}
                </pre>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Body
              </h3>
              {/* `AdminSentEmail` does not currently expose the rendered body.
                    Once it does, render it through a sandboxed iframe (sandbox=""). */}
              <p className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
                Email body is not available for sent emails.
              </p>
            </section>
          </div>
        </>
      )}
    </ProjectDetailSheet>
  )
}

function RecipientBacklinkList({ values }: { values: ReadonlyArray<string> }) {
  return (
    <span className="text-sm">
      {values.map((value, index) => (
        <Fragment key={`${value}-${index}`}>
          {index === 0 ? null : ", "}
          <RecipientBacklink value={value} className="text-sm" />
        </Fragment>
      ))}
    </span>
  )
}

function RecipientBacklink({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const userId = parseUserIdRecipient(value)

  if (userId == null) {
    return <span className={cn("text-sm", className)}>{value}</span>
  }

  return (
    <ProjectUserDrawerLink
      userId={userId}
      className={cn(
        "font-mono text-sm text-primary underline-offset-4 transition-colors hover:underline hover:transition-none",
        className
      )}
    >
      {value}
    </ProjectUserDrawerLink>
  )
}

function parseUserIdRecipient(value: string): string | null {
  if (!value.startsWith(USER_ID_RECIPIENT_PREFIX)) {
    return null
  }

  const userId = value.slice(USER_ID_RECIPIENT_PREFIX.length).trim()
  if (userId.length === 0 || userId.includes(",")) {
    return null
  }

  return userId
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

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
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
