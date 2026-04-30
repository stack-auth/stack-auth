import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import {
  EnvelopeSimpleIcon,
  MagnifyingGlassIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import type { AdminSentEmail } from "@stackframe/tanstack-start"

import { useAdminApp, useProjectId } from "@/lib/stack/admin-app"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const SENT_EMAILS_QUERY_GC_TIME_MS = 2 * 60 * 1000

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

  const selected = selectedId == null
    ? null
    : items.find((row) => row.id === selectedId) ?? null

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between gap-3 px-6">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-base font-semibold tracking-tight">
              Sent
            </h1>
            {listQuery.data == null ? null : (
              <Badge variant="secondary">{items.length.toLocaleString()}</Badge>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {listQuery.isPending ? (
          <TableSkeleton rows={8} cols={4} />
        ) : listQuery.isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Failed to load sent emails."}
          </p>
        ) : items.length === 0 ? (
          <SentEmpty />
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by recipient or subject"
                  className="ps-8"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {filtered.length} of {items.length}
              </p>
            </div>

            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No sent emails match "{search}".
              </p>
            ) : (
              <SentTable
                rows={filtered}
                onSelect={(row) => setSelectedId(row.id)}
              />
            )}
          </>
        )}
      </main>

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

function SentTable({
  rows,
  onSelect,
}: {
  rows: ReadonlyArray<AdminSentEmail>,
  onSelect: (row: AdminSentEmail) => void,
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="transition-colors hover:bg-muted/50 hover:transition-none"
            >
              <TableCell className="max-w-[240px]">
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  className="block w-full truncate text-left font-mono text-xs text-inherit"
                >
                  {row.recipient}
                </button>
              </TableCell>
              <TableCell className="max-w-[320px]">
                <span className="block truncate text-sm">{row.subject}</span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatLongDate(row.sentAt)}
                </span>
              </TableCell>
              <TableCell>
                {row.error == null ? (
                  <Badge variant="default">sent</Badge>
                ) : (
                  <Badge variant="destructive">error</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
  email: AdminSentEmail | null,
  open: boolean,
  onOpenChange: (o: boolean) => void,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
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
                  <span className="text-sm">{email.recipient}</span>
                </DetailRow>
                <DetailRow label="To">
                  <span className="text-sm">{email.to.join(", ")}</span>
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
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
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
      </SheetContent>
    </Sheet>
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
                  <Skeleton className="h-4 w-full max-w-[200px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
