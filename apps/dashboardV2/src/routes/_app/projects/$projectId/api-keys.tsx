import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  CalendarBlankIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  PlusIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { InternalApiKey, InternalApiKeyFirstView } from "@stackframe/tanstack-start"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAdminApp } from "@/lib/stack/admin-app"

export const Route = createFileRoute("/_app/projects/$projectId/api-keys")({
  component: ApiKeysPage,
})

type KeyType = "publishable" | "secret" | "super-secret"

const KEY_TYPE_LABEL: Record<KeyType, string> = {
  publishable: "Publishable",
  secret: "Secret",
  "super-secret": "Super-secret",
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function ApiKeysPage() {
  const adminApp = useAdminApp()
  const apiKeys = adminApp.useInternalApiKeys()

  const [createOpen, setCreateOpen] = useState(false)

  const sorted = useMemo(
    () =>
      [...apiKeys].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      ),
    [apiKeys]
  )

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-5xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            API keys
          </h1>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> Create key
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-8">
        {sorted.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyIcon />
              </EmptyMedia>
              <EmptyTitle>No API keys yet</EmptyTitle>
              <EmptyDescription>
                Create a key to authenticate server-side requests against this
                project.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon /> Create key
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Types</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((key) => (
                  <ApiKeyRow key={key.id} apiKey={key} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  )
}

function ApiKeyRow({ apiKey }: { apiKey: InternalApiKey }) {
  const [revokeOpen, setRevokeOpen] = useState(false)
  const revoked = apiKey.manuallyRevokedAt != null

  const tails: Array<{ type: KeyType, lastFour: string }> = []
  if (apiKey.publishableClientKey) {
    tails.push({ type: "publishable", lastFour: apiKey.publishableClientKey.lastFour })
  }
  if (apiKey.secretServerKey) {
    tails.push({ type: "secret", lastFour: apiKey.secretServerKey.lastFour })
  }
  if (apiKey.superSecretAdminKey) {
    tails.push({ type: "super-secret", lastFour: apiKey.superSecretAdminKey.lastFour })
  }

  return (
    <>
      <TableRow className={revoked ? "opacity-60" : undefined}>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium">{apiKey.description}</span>
            <div className="flex flex-wrap gap-1.5">
              {tails.map((t) => (
                <code
                  key={t.type}
                  className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  …{t.lastFour}
                </code>
              ))}
            </div>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {tails.map((t) => (
              <Badge key={t.type} variant="outline">
                {KEY_TYPE_LABEL[t.type]}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatDate(apiKey.createdAt)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {isNeverExpires(apiKey.expiresAt) ? "Never" : formatDate(apiKey.expiresAt)}
        </TableCell>
        <TableCell>
          {revoked ? (
            <Badge variant="destructive">Revoked</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
        </TableCell>
        <TableCell>
          {!revoked ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open key actions"
                  />
                }
              >
                <DotsThreeIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setRevokeOpen(true)}
                >
                  Revoke key
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </TableCell>
      </TableRow>
      <RevokeApiKeyDialog
        apiKey={apiKey}
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
      />
    </>
  )
}

function RevokeApiKeyDialog({
  apiKey,
  open,
  onOpenChange,
}: {
  apiKey: InternalApiKey,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const handleRevoke = async () => {
    await apiKey.revoke()
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
          <AlertDialogDescription>
            This will immediately invalidate{" "}
            <span className="font-medium text-foreground">{apiKey.description}</span>
            . Any service still using it will start receiving auth errors.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleRevoke}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type FormState = {
  description: string,
  expiresMode: "never" | "date",
  expiresAt: Date | null,
  hasPublishable: boolean,
  hasSecret: boolean,
  hasSuperSecret: boolean,
}

function defaultFormState(): FormState {
  const inThirtyDays = new Date()
  inThirtyDays.setDate(inThirtyDays.getDate() + 30)
  return {
    description: "",
    expiresMode: "date",
    expiresAt: inThirtyDays,
    hasPublishable: true,
    hasSecret: true,
    hasSuperSecret: false,
  }
}

// The "never expires" sentinel that the SDK accepts. We pick a date far in the
// future rather than null because `InternalApiKeyCreateOptions.expiresAt` is
// non-nullable.
const NEVER_EXPIRES = new Date("9999-12-31T23:59:59.999Z")

// Year 9000+ is treated as "never". Servers can lossy-roundtrip the exact
// sentinel timestamp, so we widen the check rather than test for strict equality.
function isNeverExpires(date: Date): boolean {
  return date.getUTCFullYear() >= 9000
}

function CreateApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const adminApp = useAdminApp()
  const [form, setForm] = useState<FormState>(defaultFormState)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Local-only secret store. Not in react-query cache, not in any global state,
  // not lifted into a parent. Cleared whenever the dialog closes (see reset()).
  const [created, setCreated] = useState<InternalApiKeyFirstView | null>(null)

  const reset = () => {
    setForm(defaultFormState())
    setSubmitting(false)
    setError(null)
    setCreated(null)
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description.trim()) {
      setError("Description is required.")
      return
    }
    if (!form.hasPublishable && !form.hasSecret && !form.hasSuperSecret) {
      setError("Select at least one key type.")
      return
    }
    if (form.expiresMode === "date" && form.expiresAt == null) {
      setError("Pick an expiry date or choose 'Never'.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const expiresAt =
        form.expiresMode === "never"
          ? NEVER_EXPIRES
          : form.expiresAt
            ?? throwErr("expiresAt unexpectedly null after validation")
      const result = await adminApp.createInternalApiKey({
        description: form.description.trim(),
        expiresAt,
        hasPublishableClientKey: form.hasPublishable,
        hasSecretServerKey: form.hasSecret,
        hasSuperSecretAdminKey: form.hasSuperSecret,
      })
      setCreated(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {created == null ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Choose what kind of key to create. Secret values are shown only
                once on the next screen.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-description">Description</Label>
                <Input
                  id="api-key-description"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="e.g. Production worker"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Expires</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={form.expiresMode === "date" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setForm({ ...form, expiresMode: "date" })}
                  >
                    On a date
                  </Button>
                  <Button
                    type="button"
                    variant={form.expiresMode === "never" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setForm({ ...form, expiresMode: "never" })}
                  >
                    Never
                  </Button>
                  {form.expiresMode === "date" ? (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button type="button" variant="outline" size="sm" />
                        }
                      >
                        <CalendarBlankIcon />
                        {form.expiresAt
                          ? formatDate(form.expiresAt)
                          : "Pick a date"}
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={form.expiresAt ?? undefined}
                          onSelect={(d) =>
                            setForm({ ...form, expiresAt: d ?? null })
                          }
                          disabled={(d: Date) => d < new Date()}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Key types</Label>
                <div className="flex flex-col gap-2 rounded-md border p-2">
                  <KeyTypeCheckbox
                    label="Publishable client key"
                    description="Safe to expose in client-side code."
                    checked={form.hasPublishable}
                    onChange={(v) => setForm({ ...form, hasPublishable: v })}
                  />
                  <KeyTypeCheckbox
                    label="Secret server key"
                    description="Server-side only. Acts on behalf of the project."
                    checked={form.hasSecret}
                    onChange={(v) => setForm({ ...form, hasSecret: v })}
                  />
                  <KeyTypeCheckbox
                    label="Super-secret admin key"
                    description="Full admin access. Use with extreme care."
                    checked={form.hasSuperSecret}
                    onChange={(v) => setForm({ ...form, hasSuperSecret: v })}
                  />
                </div>
              </div>

              {error != null ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleClose(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <CreatedKeyView
            created={created}
            onDone={() => handleClose(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function KeyTypeCheckbox({
  label,
  description,
  checked,
  onChange,
}: {
  label: string,
  description: string,
  checked: boolean,
  onChange: (next: boolean) => void,
}) {
  return (
    <Label className="flex items-start gap-2.5 rounded-sm p-1 hover:bg-muted/50 transition-colors hover:transition-none">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {description}
        </span>
      </span>
    </Label>
  )
}

function CreatedKeyView({
  created,
  onDone,
}: {
  created: InternalApiKeyFirstView,
  onDone: () => void,
}) {
  const entries: Array<{ type: KeyType, value: string }> = []
  if (created.publishableClientKey != null) {
    entries.push({ type: "publishable", value: created.publishableClientKey })
  }
  if (created.secretServerKey != null) {
    entries.push({ type: "secret", value: created.secretServerKey })
  }
  if (created.superSecretAdminKey != null) {
    entries.push({ type: "super-secret", value: created.superSecretAdminKey })
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>API key created</DialogTitle>
        <DialogDescription>
          {created.description}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
        <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Save these values now — they will not be shown again.
        </span>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => (
          <SecretReveal
            key={entry.type}
            label={KEY_TYPE_LABEL[entry.type]}
            value={entry.value}
          />
        ))}
      </div>

      <DialogFooter>
        <Button onClick={onDone}>I've saved them</Button>
      </DialogFooter>
    </div>
  )
}

function SecretReveal({ label, value }: { label: string, value: string }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Fail loud — no silent swallow.
      alert(`Failed to copy ${label} to clipboard: ${message}`)
    }
  }

  // Fixed-length mask so the rendered dot count never leaks the secret's length.
  const masked = "•".repeat(32)

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
        <code className="flex-1 truncate font-mono text-[11px]">
          {revealed ? value : masked}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? <EyeSlashIcon /> : <EyeIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  )
}
