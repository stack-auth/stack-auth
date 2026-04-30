import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckCircleIcon,
  ClockIcon,
  CopyIcon,
  GlobeIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import type { StackAdminApp } from "@stackframe/tanstack-start"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAdminApp, useProjectId } from "@/lib/stack/admin-app"

type ManagedEmailProviderListItem = Awaited<
  ReturnType<StackAdminApp["listManagedEmailDomains"]>
>[number]
type ManagedEmailProviderSetupResult = Awaited<
  ReturnType<StackAdminApp["setupManagedEmailProvider"]>
>
type ManagedEmailProviderStatus = Awaited<
  ReturnType<StackAdminApp["checkManagedEmailStatus"]>
>

export const Route = createFileRoute("/_app/projects/$projectId/emails/domains")({
  component: DomainsPage,
})

const MANAGED_EMAIL_DOMAINS_QUERY_GC_TIME_MS = 2 * 60 * 1000

type DomainStatus = ManagedEmailProviderStatus["status"]

type SetupContext = {
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
  nameServerRecords: Array<string>,
  status: DomainStatus,
}

// Hostname per RFC 1123 (label form). No spaces, must contain at least one dot
// because we expect a subdomain like `mail.example.com`. Each label 1–63 chars,
// total <= 253.
const HOSTNAME_REGEX = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
// Local-part: keep it conservative — letters, digits, dot, dash, underscore.
// No "+" routing here because some providers reject it on the From: side.
const LOCAL_PART_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/

function validateSubdomain(value: string): string | null {
  if (value.length === 0) return "Subdomain is required."
  if (/\s/.test(value)) return "Subdomain must not contain whitespace."
  if (!HOSTNAME_REGEX.test(value)) return "Enter a valid hostname (e.g. mail.example.com)."
  return null
}

function validateSenderLocalPart(value: string): string | null {
  if (value.length === 0) return "Sender is required."
  if (/\s/.test(value)) return "Sender must not contain whitespace."
  if (!LOCAL_PART_REGEX.test(value)) return "Enter a valid email local-part (e.g. noreply)."
  return null
}

function statusVariant(status: DomainStatus): "default" | "secondary" | "destructive" {
  if (status === "applied" || status === "verified") return "default"
  if (status === "failed") return "destructive"
  return "secondary"
}

function statusLabel(status: DomainStatus): string {
  switch (status) {
    case "pending_dns": return "Pending DNS"
    case "pending_verification": return "Verifying"
    case "verified": return "Verified"
    case "applied": return "Applied"
    case "failed": return "Failed"
    default: throw new Error(`Unhandled managed email domain status: ${status satisfies never}`)
  }
}

function DomainsPage() {
  const adminApp = useAdminApp()
  const projectId = useProjectId()
  const queryClient = useQueryClient()

  const [setupOpen, setSetupOpen] = useState(false)
  const [recordsContext, setRecordsContext] = useState<SetupContext | null>(null)
  const [confirmApply, setConfirmApply] = useState<ManagedEmailProviderListItem | null>(null)

  const listQueryKey = ["managed-email-domains", projectId] as const
  const listQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: async () => await adminApp.listManagedEmailDomains(),
    gcTime: MANAGED_EMAIL_DOMAINS_QUERY_GC_TIME_MS,
  })

  const invalidateList = () => {
    void queryClient.invalidateQueries({ queryKey: listQueryKey })
  }

  const applyMutation = useMutation({
    mutationFn: async (domainId: string) => await adminApp.applyManagedEmailProvider({ domainId }),
    onSuccess: () => {
      toast.success("Managed email domain applied")
      invalidateList()
      setRecordsContext(null)
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to apply managed email domain")
    },
  })

  const handleViewRecords = async (item: ManagedEmailProviderListItem) => {
    // Refresh status before opening the records view so the user sees the latest
    // verification state instead of whatever the list query has cached.
    const fresh = await adminApp.checkManagedEmailStatus({
      domainId: item.domainId,
      subdomain: item.subdomain,
      senderLocalPart: item.senderLocalPart,
    })
    setRecordsContext({
      domainId: item.domainId,
      subdomain: item.subdomain,
      senderLocalPart: item.senderLocalPart,
      nameServerRecords: item.nameServerRecords,
      status: fresh.status,
    })
    invalidateList()
  }

  const items = listQuery.data ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Email domains</h2>
          <p className="text-xs text-muted-foreground">
            Send authentication emails from your own domain instead of the Stack default.
          </p>
        </div>
        <Button onClick={() => setSetupOpen(true)}>
          <PlusIcon />
          Add domain
        </Button>
      </div>

      {listQuery.isPending ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load domains</AlertTitle>
          <AlertDescription>
            {listQuery.error instanceof Error ? listQuery.error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <DomainsEmpty onAdd={() => setSetupOpen(true)} />
      ) : (
        <DomainsTable
          rows={items}
          onViewRecords={(row) => {
            void handleViewRecords(row)
          }}
          onRequestApply={(row) => setConfirmApply(row)}
        />
      )}

      <SetupDialog
        open={setupOpen}
        onOpenChange={(o) => setSetupOpen(o)}
        onSetupComplete={(ctx) => {
          setSetupOpen(false)
          setRecordsContext(ctx)
          invalidateList()
        }}
      />

      <RecordsDialog
        context={recordsContext}
        open={recordsContext != null}
        onOpenChange={(o) => {
          if (!o) setRecordsContext(null)
        }}
        onStatusUpdated={(status) => {
          setRecordsContext((prev) => (prev == null ? prev : { ...prev, status }))
          invalidateList()
        }}
        onApply={(domainId) => applyMutation.mutate(domainId)}
        applying={applyMutation.isPending}
      />

      <AlertDialog
        open={confirmApply != null}
        onOpenChange={(o) => {
          if (!o) setConfirmApply(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this domain?</AlertDialogTitle>
            <AlertDialogDescription>
              All future authentication emails for this project will be sent from
              {confirmApply == null
                ? null
                : ` ${confirmApply.senderLocalPart}@${confirmApply.subdomain}`}
              . You can reapply or change this later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={applyMutation.isPending}
              onClick={() => {
                if (confirmApply == null) return
                applyMutation.mutate(confirmApply.domainId)
                setConfirmApply(null)
              }}
            >
              {applyMutation.isPending ? "Applying…" : "Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DomainsEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GlobeIcon />
          </EmptyMedia>
          <EmptyTitle>Send from your own domain</EmptyTitle>
          <EmptyDescription>
            Configure a managed email domain so users receive verification and
            password-reset emails from <span className="font-mono">you@yourdomain.com</span>{" "}
            instead of the Stack default sender.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onAdd}>
            <PlusIcon />
            Set up your first domain
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function DomainsTable({
  rows,
  onViewRecords,
  onRequestApply,
}: {
  rows: ReadonlyArray<ManagedEmailProviderListItem>,
  onViewRecords: (row: ManagedEmailProviderListItem) => void,
  onRequestApply: (row: ManagedEmailProviderListItem) => void,
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Domain</TableHead>
            <TableHead>Sender</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[260px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const canApply = row.status === "verified"
            return (
              <TableRow key={row.domainId}>
                <TableCell className="font-mono text-xs">{row.subdomain}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.senderLocalPart}@{row.subdomain}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onViewRecords(row)}
                    >
                      View DNS records
                    </Button>
                    {canApply ? (
                      <Button size="sm" onClick={() => onRequestApply(row)}>
                        Apply
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function SetupDialog({
  open,
  onOpenChange,
  onSetupComplete,
}: {
  open: boolean,
  onOpenChange: (o: boolean) => void,
  onSetupComplete: (ctx: SetupContext) => void,
}) {
  const adminApp = useAdminApp()
  const [subdomain, setSubdomain] = useState("")
  const [senderLocalPart, setSenderLocalPart] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)

  const subdomainError = subdomain.length === 0 ? null : validateSubdomain(subdomain)
  const senderError = senderLocalPart.length === 0 ? null : validateSenderLocalPart(senderLocalPart)

  const setupMutation = useMutation({
    mutationFn: async (input: { subdomain: string, senderLocalPart: string }) => {
      const result: ManagedEmailProviderSetupResult = await adminApp.setupManagedEmailProvider({
        subdomain: input.subdomain,
        senderLocalPart: input.senderLocalPart,
      })
      return result
    },
    onSuccess: (result) => {
      onSetupComplete({
        domainId: result.domainId,
        subdomain: result.subdomain,
        senderLocalPart: result.senderLocalPart,
        nameServerRecords: result.nameServerRecords,
        status: result.status,
      })
      // Reset for next time
      setSubdomain("")
      setSenderLocalPart("")
      setSubmitError(null)
    },
    onError: (err: unknown) => {
      setSubmitError(err instanceof Error ? err.message : "Failed to set up managed email domain.")
    },
  })

  const handleSubmit = () => {
    const sErr = validateSubdomain(subdomain)
    const lErr = validateSenderLocalPart(senderLocalPart)
    if (sErr != null || lErr != null) {
      setSubmitError(sErr ?? lErr)
      return
    }
    setSubmitError(null)
    setupMutation.mutate({ subdomain, senderLocalPart })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSubmitError(null)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an email domain</DialogTitle>
          <DialogDescription>
            Choose the subdomain and sender address you want Stack to send authentication
            emails from. We'll generate the DNS records you need to configure next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="domain-subdomain">Subdomain</Label>
            <Input
              id="domain-subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              placeholder="mail.example.com"
              autoComplete="off"
              spellCheck={false}
            />
            {subdomainError != null ? (
              <p className="text-xs text-destructive">{subdomainError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use a subdomain you control (e.g. <span className="font-mono">mail.example.com</span>).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="domain-sender">Sender</Label>
            <Input
              id="domain-sender"
              value={senderLocalPart}
              onChange={(e) => setSenderLocalPart(e.target.value)}
              placeholder="noreply"
              autoComplete="off"
              spellCheck={false}
            />
            {senderError != null ? (
              <p className="text-xs text-destructive">{senderError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The local-part of the From: address. Final sender:{" "}
                <span className="font-mono">
                  {senderLocalPart.length === 0 ? "noreply" : senderLocalPart}@
                  {subdomain.length === 0 ? "mail.example.com" : subdomain}
                </span>
              </p>
            )}
          </div>

          {submitError != null ? (
            <Alert variant="destructive">
              <AlertTitle>Setup failed</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={setupMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              setupMutation.isPending
              || subdomain.length === 0
              || senderLocalPart.length === 0
              || subdomainError != null
              || senderError != null
            }
          >
            {setupMutation.isPending ? "Setting up…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordsDialog({
  context,
  open,
  onOpenChange,
  onStatusUpdated,
  onApply,
  applying,
}: {
  context: SetupContext | null,
  open: boolean,
  onOpenChange: (o: boolean) => void,
  onStatusUpdated: (status: DomainStatus) => void,
  onApply: (domainId: string) => void,
  applying: boolean,
}) {
  const adminApp = useAdminApp()
  const [checkError, setCheckError] = useState<string | null>(null)

  const checkMutation = useMutation({
    mutationFn: async (input: { domainId: string, subdomain: string, senderLocalPart: string }) => {
      return await adminApp.checkManagedEmailStatus(input)
    },
    onSuccess: (result) => {
      setCheckError(null)
      onStatusUpdated(result.status)
    },
    onError: (err: unknown) => {
      setCheckError(err instanceof Error ? err.message : "Failed to check verification status.")
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setCheckError(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {context == null ? null : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <GlobeIcon className="size-4" />
                <span className="font-mono text-base">{context.subdomain}</span>
              </DialogTitle>
              <DialogDescription>
                Sender:{" "}
                <span className="font-mono">
                  {context.senderLocalPart}@{context.subdomain}
                </span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  Status
                </span>
                <StatusInline status={context.status} />
              </div>

              <Alert>
                <AlertTitle>Add these records to your DNS provider</AlertTitle>
                <AlertDescription>
                  Verification may take up to 48 hours after the records are propagated.
                  Use "Check status" once you've added them.
                </AlertDescription>
              </Alert>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead className="w-[80px] text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {context.nameServerRecords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                          No DNS records returned.
                        </TableCell>
                      </TableRow>
                    ) : (
                      context.nameServerRecords.map((value) => (
                        <TableRow key={value}>
                          <TableCell className="font-mono text-xs">NS</TableCell>
                          <TableCell className="max-w-[420px]">
                            <span className="block truncate font-mono text-xs">{value}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <CopyButton value={value} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {checkError != null ? (
                <Alert variant="destructive">
                  <AlertTitle>Status check failed</AlertTitle>
                  <AlertDescription>{checkError}</AlertDescription>
                </Alert>
              ) : null}
            </div>

            <DialogFooter className="flex-row justify-between sm:justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  checkMutation.mutate({
                    domainId: context.domainId,
                    subdomain: context.subdomain,
                    senderLocalPart: context.senderLocalPart,
                  })
                }}
                disabled={checkMutation.isPending}
              >
                {checkMutation.isPending ? "Checking…" : "Check status"}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                {context.status === "verified" ? (
                  <Button
                    onClick={() => onApply(context.domainId)}
                    disabled={applying}
                  >
                    {applying ? "Applying…" : "Apply"}
                  </Button>
                ) : null}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusInline({ status }: { status: DomainStatus }) {
  if (status === "verified" || status === "applied") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground">
        <CheckCircleIcon className="size-3.5" />
        {statusLabel(status)}
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <WarningCircleIcon className="size-3.5" />
        {statusLabel(status)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <ClockIcon className="size-3.5" />
      {statusLabel(status)}
    </span>
  )
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy value"
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        toast.success("Copied to clipboard")
      }}
    >
      <CopyIcon />
    </Button>
  )
}
