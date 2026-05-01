/**
 * Webhooks page.
 *
 * Implementation choice: a thin custom UI built directly on top of the Svix
 * Management API. We obtain a scoped Svix token and base URL from
 * `useSvixTokenQuery()` (see
 * `packages/template/src/lib/stack-app/apps/interfaces/admin-app.ts`) and
 * authenticate with `Authorization: Bearer ${token}`. The Svix `app_id`
 * matches the Stack Auth project id (verified against the legacy webhooks
 * page's API shape; UI was NOT copied).
 *
 * We deliberately did NOT pull in `@svix/react` / `svix-react` — those
 * packages are not in `apps/dashboardV2/package.json` and adding them mid-task
 * is forbidden by the harness rules.
 *
 * Test events are sent through the SDK's `adminApp.sendTestWebhook(...)` so
 * the dispatch path matches what production users get.
 *
 * React Query is used for all Svix calls. Query keys:
 *   - ['svix-endpoints', projectId]                -> list endpoints
 *   - ['svix-endpoint-secret', projectId, epId]    -> reveal signing secret
 *   - ['svix-message-attempts', projectId, epId]   -> recent deliveries
 */

import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  EyeSlashIcon,
  GlobeHemisphereWestIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"

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
import { Skeleton } from "@/components/ui/skeleton"
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ProjectDetailSheet } from "@/components/console/project-detail-sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { cn } from "@/lib/utils"
import { useAdminApp } from "@/lib/stack/admin-app"
import { useSvixTokenQuery } from "@/lib/stack/react-query"
import { useTableKeyboardSelection } from "@/hooks/use-table-keyboard-selection"

export const Route = createFileRoute("/_app/projects/$projectId/webhooks")({
  component: WebhooksPage,
})

const WEBHOOKS_QUERY_GC_TIME_MS = 2 * 60 * 1000

// -------------------------------------------------------------------- types --

function WebhooksSkeleton() {
  return (
    <ProjectPage>
      <PageHeader onCreate={null} />
      <ProjectPageMain className="space-y-6">
        <TableSkeleton rows={4} cols={5} />
      </ProjectPageMain>
    </ProjectPage>
  )
}

type SvixEndpoint = {
  id: string
  url: string
  description: string
  disabled: boolean
  filterTypes: Array<string> | null
  createdAt: string
  updatedAt: string
}

type SvixListResponse<T> = {
  data: Array<T>
  iterator: string | null
  done: boolean
}

type SvixEndpointRaw = {
  id: string
  url: string
  description?: string
  disabled?: boolean
  filterTypes?: Array<string> | null
  createdAt: string
  updatedAt: string
}

type SvixMessageAttempt = {
  id: string
  status: number // 0 success, 1 pending, 2 failing, 3 sending
  responseStatusCode: number
  timestamp: string
  msgId: string
}

type SvixError = {
  status: number
  body: unknown
  message: string
}

// -------------------------------------------------------- HTTP plumbing -----

function buildSvixUrl(baseUrl: string, path: string): string {
  // Normalize: baseUrl may or may not have trailing slash, path always starts with /api/...
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
  return `${trimmed}${path}`
}

async function svixFetch<T>(args: {
  baseUrl: string
  token: string
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  body?: unknown
}): Promise<T> {
  const res = await fetch(buildSvixUrl(args.baseUrl, args.path), {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: args.body == null ? undefined : JSON.stringify(args.body),
  })

  if (!res.ok) {
    let parsed: unknown = null
    let text = ""
    try {
      text = await res.text()
      parsed = text.length > 0 ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    const err: SvixError = {
      status: res.status,
      body: parsed,
      message:
        (parsed != null &&
        typeof parsed === "object" &&
        "detail" in parsed &&
        typeof parsed.detail === "string"
          ? (parsed as { detail: string }).detail
          : null) ?? `Svix request failed: ${res.status} ${res.statusText}`,
    }
    throw new Error(err.message)
  }

  // DELETE endpoints typically return 204 No Content.
  if (res.status === 204) {
    // Caller's T must be compatible with `undefined` for 204 paths. We only
    // call this where the type is `void`/`undefined`, so this is safe.
    return undefined as T
  }
  return (await res.json()) as T
}

function normalizeEndpoint(e: SvixEndpointRaw): SvixEndpoint {
  return {
    id: e.id,
    url: e.url,
    description: e.description ?? "",
    disabled: e.disabled ?? false,
    filterTypes: e.filterTypes ?? null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

// ------------------------------------------------------------- main page ----

function WebhooksPage() {
  const adminApp = useAdminApp()
  const projectId = adminApp.projectId
  const svixTokenQuery = useSvixTokenQuery(adminApp)
  const svixToken = svixTokenQuery.data

  if (svixTokenQuery.isError) {
    return (
      <ProjectPage>
        <PageHeader onCreate={null} />
        <ProjectPageMain className="space-y-6">
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>Webhooks are unavailable</AlertTitle>
            <AlertDescription>
              {svixTokenQuery.error instanceof Error
                ? svixTokenQuery.error.message
                : "Failed to load Svix token."}
            </AlertDescription>
          </Alert>
        </ProjectPageMain>
      </ProjectPage>
    )
  }

  if (svixToken == null) {
    return <WebhooksSkeleton />
  }

  const tokenError =
    svixToken.url == null || svixToken.url.trim() === ""
      ? "Svix is not configured for this deployment. The dashboard could not obtain a Svix server URL."
      : svixToken.token.trim() === ""
        ? "Stack Auth could not issue a Svix token for this project."
        : null

  if (tokenError != null) {
    return (
      <ProjectPage>
        <PageHeader onCreate={null} />
        <ProjectPageMain className="space-y-6">
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>Webhooks are unavailable</AlertTitle>
            <AlertDescription>{tokenError}</AlertDescription>
          </Alert>
        </ProjectPageMain>
      </ProjectPage>
    )
  }

  // Refined, non-null. Captured locally so closures don't need to re-narrow.
  const baseUrl =
    svixToken.url ?? throwErr("svixToken.url unexpectedly null after guard")
  return (
    <WebhooksPageInner
      projectId={projectId}
      baseUrl={baseUrl}
      token={svixToken.token}
    />
  )
}

function WebhooksPageInner({
  projectId,
  baseUrl,
  token,
}: {
  projectId: string
  baseUrl: string
  token: string
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(
    null
  )

  const endpointsQuery = useQuery({
    queryKey: ["svix-endpoints", projectId],
    queryFn: async () => {
      const res = await svixFetch<SvixListResponse<SvixEndpointRaw>>({
        baseUrl,
        token,
        method: "GET",
        path: `/api/v1/app/${encodeURIComponent(projectId)}/endpoint/?limit=100`,
      })
      return res.data.map(normalizeEndpoint)
    },
    gcTime: WEBHOOKS_QUERY_GC_TIME_MS,
  })

  useTableKeyboardSelection({
    items: endpointsQuery.data ?? [],
    getItemKey: (endpoint) => endpoint.id,
    selectedItemKey: selectedEndpointId,
    onSelectItemKey: setSelectedEndpointId,
  })

  return (
    <ProjectPage>
      <PageHeader onCreate={() => setCreateOpen(true)} />

      <ProjectPageMain className="space-y-6">
        {endpointsQuery.isError ? (
          <Alert variant="destructive">
            <WarningCircleIcon />
            <AlertTitle>Could not load webhook endpoints</AlertTitle>
            <AlertDescription>
              {endpointsQuery.error instanceof Error
                ? endpointsQuery.error.message
                : "Unknown error"}
            </AlertDescription>
          </Alert>
        ) : null}

        {endpointsQuery.isLoading ? <TableSkeleton rows={4} cols={5} /> : null}

        {endpointsQuery.data != null ? (
          endpointsQuery.data.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <GlobeHemisphereWestIcon />
                </EmptyMedia>
                <EmptyTitle>No webhook endpoints</EmptyTitle>
                <EmptyDescription>
                  Add an endpoint URL to start receiving Stack Auth events on
                  your server.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setCreateOpen(true)}>
                  <PlusIcon /> New endpoint
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Event types</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpointsQuery.data.map((endpoint) => (
                    <EndpointRow
                      key={endpoint.id}
                      endpoint={endpoint}
                      projectId={projectId}
                      baseUrl={baseUrl}
                      token={token}
                      selected={selectedEndpointId === endpoint.id}
                      onOpenDetail={() => setSelectedEndpointId(endpoint.id)}
                      onDetailOpenChange={(nextOpen) => {
                        if (!nextOpen) setSelectedEndpointId(null)
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : null}
      </ProjectPageMain>

      <CreateEndpointDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        baseUrl={baseUrl}
        token={token}
      />
    </ProjectPage>
  )
}

function PageHeader({ onCreate }: { onCreate: (() => void) | null }) {
  return (
    <ProjectPageHeader
      title="Webhooks"
      actions={
        onCreate != null ? (
          <Button onClick={onCreate}>
            <PlusIcon /> New endpoint
          </Button>
        ) : null
      }
    />
  )
}

// ----------------------------------------------------------- row + actions --

function EndpointRow({
  endpoint,
  projectId,
  baseUrl,
  token,
  selected,
  onOpenDetail,
  onDetailOpenChange,
}: {
  endpoint: SvixEndpoint
  projectId: string
  baseUrl: string
  token: string
  selected: boolean
  onOpenDetail: () => void
  onDetailOpenChange: (nextOpen: boolean) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const adminApp = useAdminApp()
  const [testError, setTestError] = useState<string | null>(null)
  const [testSuccess, setTestSuccess] = useState(false)

  const handleSendTest = async () => {
    setTestError(null)
    setTestSuccess(false)
    const result = await adminApp.sendTestWebhook({ endpointId: endpoint.id })
    if (result.status === "ok") {
      setTestSuccess(true)
      // Auto-clear after a short window so the row doesn't get stuck green.
      setTimeout(() => setTestSuccess(false), 2500)
    } else {
      setTestError(result.error.errorMessage)
    }
  }

  const eventTypeLabel =
    endpoint.filterTypes == null || endpoint.filterTypes.length === 0
      ? "All events"
      : `${endpoint.filterTypes.length} type${endpoint.filterTypes.length === 1 ? "" : "s"}`

  return (
    <>
      <TableRow
        className={cn(
          "transition-colors hover:bg-muted/50 hover:transition-none",
          endpoint.disabled && "opacity-60",
          selected && "bg-muted/70"
        )}
        aria-current={selected ? "true" : undefined}
      >
        <TableCell>
          <button
            type="button"
            onClick={onOpenDetail}
            className="text-left text-xs font-medium transition-colors hover:underline hover:transition-none"
          >
            {endpoint.url}
          </button>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {endpoint.description.length > 0 ? endpoint.description : "—"}
        </TableCell>
        <TableCell>
          <Badge variant="outline">{eventTypeLabel}</Badge>
        </TableCell>
        <TableCell>
          {testError != null ? (
            <Badge variant="destructive">Test failed</Badge>
          ) : testSuccess ? (
            <Badge variant="secondary">Test sent</Badge>
          ) : endpoint.disabled ? (
            <Badge variant="destructive">Disabled</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
        </TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open endpoint actions"
                />
              }
            >
              <DotsThreeIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenDetail}>
                View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSendTest}>
                <PaperPlaneTiltIcon /> Send test event
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <EndpointDetailSheet
        endpoint={endpoint}
        projectId={projectId}
        baseUrl={baseUrl}
        token={token}
        open={selected}
        onOpenChange={onDetailOpenChange}
      />
      <EditEndpointDialog
        endpoint={endpoint}
        projectId={projectId}
        baseUrl={baseUrl}
        token={token}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <DeleteEndpointDialog
        endpoint={endpoint}
        projectId={projectId}
        baseUrl={baseUrl}
        token={token}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      {testError != null ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-destructive/5">
            <Alert variant="destructive">
              <WarningCircleIcon />
              <AlertTitle>Test event failed</AlertTitle>
              <AlertDescription>{testError}</AlertDescription>
            </Alert>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

// ------------------------------------------------------------ create dialog --

type CreateFormState = {
  url: string
  description: string
}

function defaultCreateForm(): CreateFormState {
  return { url: "", description: "" }
}

function isValidHttpsUrl(input: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return false
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
}

function CreateEndpointDialog({
  open,
  onOpenChange,
  projectId,
  baseUrl,
  token,
}: {
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  projectId: string
  baseUrl: string
  token: string
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateFormState>(defaultCreateForm)
  const [error, setError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async (values: CreateFormState) => {
      return await svixFetch<SvixEndpointRaw>({
        baseUrl,
        token,
        method: "POST",
        path: `/api/v1/app/${encodeURIComponent(projectId)}/endpoint/`,
        body: {
          url: values.url,
          description:
            values.description.length > 0 ? values.description : undefined,
        },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["svix-endpoints", projectId],
      })
    },
  })

  const reset = () => {
    setForm(defaultCreateForm())
    setError(null)
    createMutation.reset()
  }

  const handleClose = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedUrl = form.url.trim()
    if (trimmedUrl.length === 0) {
      setError("Endpoint URL is required.")
      return
    }
    if (!isValidHttpsUrl(trimmedUrl)) {
      setError("Endpoint URL must be a valid http(s) URL.")
      return
    }
    try {
      await createMutation.mutateAsync({
        url: trimmedUrl,
        description: form.description.trim(),
      })
      handleClose(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create endpoint."
      )
    }
  }

  const insecure = form.url.startsWith("http://")

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New webhook endpoint</DialogTitle>
            <DialogDescription>
              Stack Auth will POST signed event payloads to this URL.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/webhooks/stack"
                autoFocus
                required
                type="url"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-description">
                Description (optional)
              </Label>
              <Textarea
                id="webhook-description"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="What is this endpoint used for?"
              />
            </div>

            {insecure ? (
              <Alert variant="destructive">
                <WarningCircleIcon />
                <AlertTitle>Insecure URL</AlertTitle>
                <AlertDescription>
                  Plain http:// endpoints transmit user data in the clear. Use
                  https:// in any non-development environment.
                </AlertDescription>
              </Alert>
            ) : null}

            {error != null ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleClose(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create endpoint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// -------------------------------------------------------------- edit dialog --

function EditEndpointDialog({
  endpoint,
  projectId,
  baseUrl,
  token,
  open,
  onOpenChange,
}: {
  endpoint: SvixEndpoint
  projectId: string
  baseUrl: string
  token: string
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [description, setDescription] = useState(endpoint.description)
  const [url, setUrl] = useState(endpoint.url)
  const [error, setError] = useState<string | null>(null)

  const editMutation = useMutation({
    mutationFn: async (values: { url: string; description: string }) => {
      return await svixFetch<SvixEndpointRaw>({
        baseUrl,
        token,
        method: "PATCH",
        path: `/api/v1/app/${encodeURIComponent(projectId)}/endpoint/${encodeURIComponent(endpoint.id)}/`,
        body: {
          url: values.url,
          description: values.description,
        },
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["svix-endpoints", projectId],
      })
    },
  })

  const handleClose = (next: boolean) => {
    if (!next) {
      setDescription(endpoint.description)
      setUrl(endpoint.url)
      setError(null)
      editMutation.reset()
    }
    onOpenChange(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!isValidHttpsUrl(url.trim())) {
      setError("Endpoint URL must be a valid http(s) URL.")
      return
    }
    try {
      await editMutation.mutateAsync({
        url: url.trim(),
        description: description.trim(),
      })
      handleClose(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update endpoint."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Edit endpoint</DialogTitle>
            <DialogDescription>
              Update the endpoint URL or description.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-url">Endpoint URL</Label>
              <Input
                id="edit-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                type="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
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
              disabled={editMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editMutation.isPending}>
              {editMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------ delete dialog --

function DeleteEndpointDialog({
  endpoint,
  projectId,
  baseUrl,
  token,
  open,
  onOpenChange,
}: {
  endpoint: SvixEndpoint
  projectId: string
  baseUrl: string
  token: string
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await svixFetch<undefined>({
        baseUrl,
        token,
        method: "DELETE",
        path: `/api/v1/app/${encodeURIComponent(projectId)}/endpoint/${encodeURIComponent(endpoint.id)}/`,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["svix-endpoints", projectId],
      })
    },
  })

  const handleDelete = async () => {
    setError(null)
    try {
      await deleteMutation.mutateAsync()
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete endpoint."
      )
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{endpoint.url}</span>{" "}
            will stop receiving events immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error != null ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete}>
            Delete endpoint
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ------------------------------------------------------------ detail sheet --

function EndpointDetailSheet({
  endpoint,
  projectId,
  baseUrl,
  token,
  open,
  onOpenChange,
}: {
  endpoint: SvixEndpoint
  projectId: string
  baseUrl: string
  token: string
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
}) {
  return (
    <ProjectDetailSheet
      open={open}
      onOpenChange={onOpenChange}
      className="gap-0 overflow-y-auto"
    >
      <SheetHeader>
        <SheetTitle className="text-lg">{endpoint.url}</SheetTitle>
        <SheetDescription>
          {endpoint.description.length > 0
            ? endpoint.description
            : "No description"}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-6 pb-6">
        <SigningSecretSection
          endpoint={endpoint}
          projectId={projectId}
          baseUrl={baseUrl}
          token={token}
        />
        <RecentDeliveriesSection
          endpoint={endpoint}
          projectId={projectId}
          baseUrl={baseUrl}
          token={token}
        />
      </div>
    </ProjectDetailSheet>
  )
}

function SigningSecretSection({
  endpoint,
  projectId,
  baseUrl,
  token,
}: {
  endpoint: SvixEndpoint
  projectId: string
  baseUrl: string
  token: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const secretQuery = useQuery({
    queryKey: ["svix-endpoint-secret", projectId, endpoint.id],
    enabled: revealed,
    queryFn: async () => {
      const res = await svixFetch<{ key: string }>({
        baseUrl,
        token,
        method: "GET",
        path: `/api/v1/app/${encodeURIComponent(projectId)}/endpoint/${encodeURIComponent(endpoint.id)}/secret/`,
      })
      return res.key
    },
    gcTime: WEBHOOKS_QUERY_GC_TIME_MS,
  })

  const handleCopy = async () => {
    if (secretQuery.data == null) return
    await navigator.clipboard.writeText(secretQuery.data)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          Signing secret
        </h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Use this secret to verify the webhook signature on incoming requests.
      </p>
      <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
        {revealed && secretQuery.isLoading ? (
          <Skeleton className="h-4 flex-1" />
        ) : (
          <code className="flex-1 truncate font-mono text-[11px]">
            {!revealed
              ? "•".repeat(40)
              : secretQuery.isError
                ? "Failed to load"
                : (secretQuery.data ?? "")}
          </code>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={
            revealed ? "Hide signing secret" : "Reveal signing secret"
          }
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? <EyeSlashIcon /> : <EyeIcon />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Copied" : "Copy signing secret"}
          onClick={handleCopy}
          disabled={secretQuery.data == null}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      {secretQuery.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>Could not load signing secret</AlertTitle>
          <AlertDescription>
            {secretQuery.error instanceof Error
              ? secretQuery.error.message
              : "Unknown error"}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function attemptStatusLabel(status: number): {
  label: string
  variant: "secondary" | "destructive" | "outline"
} {
  switch (status) {
    case 0:
      return { label: "Success", variant: "secondary" }
    case 1:
      return { label: "Pending", variant: "outline" }
    case 2:
      return { label: "Failing", variant: "destructive" }
    case 3:
      return { label: "Sending", variant: "outline" }
    default:
      return { label: `Unknown (${status})`, variant: "outline" }
  }
}

function RecentDeliveriesSection({
  endpoint,
  projectId,
  baseUrl,
  token,
}: {
  endpoint: SvixEndpoint
  projectId: string
  baseUrl: string
  token: string
}) {
  const attemptsQuery = useQuery({
    queryKey: ["svix-message-attempts", projectId, endpoint.id],
    queryFn: async () => {
      const res = await svixFetch<SvixListResponse<SvixMessageAttempt>>({
        baseUrl,
        token,
        method: "GET",
        path: `/api/v1/app/${encodeURIComponent(projectId)}/endpoint/${encodeURIComponent(endpoint.id)}/attempt/?limit=20`,
      })
      return res.data
    },
    gcTime: WEBHOOKS_QUERY_GC_TIME_MS,
  })

  return (
    <section className="space-y-2">
      <h3 className="font-heading text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        Recent deliveries
      </h3>
      {attemptsQuery.isLoading ? <TableSkeleton rows={5} cols={3} /> : null}
      {attemptsQuery.isError ? (
        <Alert variant="destructive">
          <WarningCircleIcon />
          <AlertTitle>Could not load delivery attempts</AlertTitle>
          <AlertDescription>
            {attemptsQuery.error instanceof Error
              ? attemptsQuery.error.message
              : "Unknown error"}
          </AlertDescription>
        </Alert>
      ) : null}
      {attemptsQuery.data != null ? (
        attemptsQuery.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No deliveries yet. Send a test event to verify your endpoint.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attemptsQuery.data.map((a) => {
                  const status = attemptStatusLabel(a.status)
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">
                        {a.responseStatusCode}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <FormattedTimestamp value={a.timestamp} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : null}
    </section>
  )
}

function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="rounded-lg border">
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

function FormattedTimestamp({ value }: { value: string }) {
  const formatted = useMemo(() => {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }, [value])
  return <span>{formatted}</span>
}
