import { useEffect, useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  CheckIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useAdminProject,
  useLoadedAdminProjectConfig,
  useStackAuthQueryInvalidation,
} from "@/lib/stack/react-query"

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  component: ProjectSettingsPage,
})

function ProjectSettingsPage() {
  useAdminProject(useAdminApp())

  return (
    <ProjectPage>
      <ProjectPageHeader title="Settings" />

      <ProjectPageMain className="space-y-8">
        <GeneralCard />
        <DomainsCard />
        <DangerZoneCard />
      </ProjectPageMain>
    </ProjectPage>
  )
}

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

function GeneralCard() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const { invalidateProject } = useStackAuthQueryInvalidation()

  const [displayName, setDisplayName] = useState(project.displayName)
  const [description, setDescription] = useState(project.description ?? "")

  // Re-sync local form state when the underlying project changes (eg. after a successful save
  // the SDK invalidates and we get fresh server values).
  useEffect(() => {
    setDisplayName(project.displayName)
  }, [project.displayName])
  useEffect(() => {
    setDescription(project.description ?? "")
  }, [project.description])

  const trimmedName = displayName.trim()
  const trimmedDescription = description.trim()

  const nameDirty = trimmedName !== project.displayName
  const descriptionDirty = trimmedDescription !== (project.description ?? "")

  const saveName = async () => {
    if (!nameDirty) return
    if (trimmedName.length === 0) {
      toast.error("Display name cannot be empty.")
      return
    }
    await project.update({ displayName: trimmedName })
    await invalidateProject(project.id)
    toast.success("Display name updated.")
  }

  const saveDescription = async () => {
    if (!descriptionDirty) return
    await project.update({ description: trimmedDescription })
    await invalidateProject(project.id)
    toast.success("Description updated.")
  }

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-medium tracking-tight">General</h2>
      <Card>
        <CardHeader>
          <CardTitle>Identification</CardTitle>
          <CardDescription>
            How this project appears across the dashboard and in user-facing flows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="project-display-name">Display name</Label>
            <div className="flex gap-2">
              <Input
                id="project-display-name"
                value={displayName}
                maxLength={100}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Button
                type="button"
                disabled={!nameDirty}
                onClick={saveName}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!nameDirty}
                onClick={() => setDisplayName(project.displayName)}
              >
                Discard
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={description}
              maxLength={1000}
              placeholder="Optional. Visible only to project admins."
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!descriptionDirty}
                onClick={() => setDescription(project.description ?? "")}
              >
                Discard
              </Button>
              <Button
                type="button"
                disabled={!descriptionDirty}
                onClick={saveDescription}
              >
                Save
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2">
            <ReadOnlyRow label="Project ID">
              <CopyableId value={project.id} />
            </ReadOnlyRow>
            <ReadOnlyRow label="Created">
              <span className="text-sm">
                {new Date(project.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </ReadOnlyRow>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Domains                                                             */
/* ------------------------------------------------------------------ */

type TrustedDomainEntry = {
  id: string,
  baseUrl: string,
  handlerPath: string,
}

function useTrustedDomains(): { allowLocalhost: boolean, domains: Array<TrustedDomainEntry> } {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const config = useLoadedAdminProjectConfig(project)

  // The schema declares `domains.trustedDomains` as a record `{ [id]: { baseUrl, handlerPath } }`.
  // The SDK's rendered-config type guarantees the shape; we still validate the leaf fields below
  // to fail loud if the runtime ever drifts from the type.
  const rawDomains = config.domains.trustedDomains

  const domains: Array<TrustedDomainEntry> = Object.entries(rawDomains).map(([id, entry]) => {
    const baseUrl = entry.baseUrl
    const handlerPath = entry.handlerPath
    if (typeof baseUrl !== "string" || typeof handlerPath !== "string") {
      throw new Error(
        `Trusted domain entry ${id} missing baseUrl/handlerPath: ${JSON.stringify(entry)}`,
      )
    }
    return { id, baseUrl, handlerPath }
  })

  return {
    allowLocalhost: config.domains.allowLocalhost === true,
    domains,
  }
}

function DomainsCard() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const { allowLocalhost, domains } = useTrustedDomains()

  const toggleAllowLocalhost = async (next: boolean) => {
    try {
      await project.updateConfig({ "domains.allowLocalhost": next })
      await invalidateProjectConfig(project.id)
      toast.success(next ? "Localhost is now allowed." : "Localhost is no longer allowed.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update localhost setting.")
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-medium tracking-tight">
        Domains and local development
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>Trusted domains</CardTitle>
          <CardDescription>
            Domains that may host the Stack Auth handler. Sign-in callbacks and OAuth redirects
            will be rejected for any origin not listed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="allow-localhost" className="text-xs font-medium">
                Allow localhost in development
              </Label>
              <p className="text-xs text-muted-foreground">
                Skips the trusted-domain check for `http://localhost`. Disable in production.
              </p>
            </div>
            <Switch
              id="allow-localhost"
              checked={allowLocalhost}
              onCheckedChange={(next) => {
                void toggleAllowLocalhost(next)
              }}
            />
          </div>

          <DomainList domains={domains} />
          <AddDomainForm existingIds={domains.map((d) => d.id)} />
        </CardContent>
      </Card>
    </section>
  )
}

function DomainList({ domains }: { domains: Array<TrustedDomainEntry> }) {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()

  const removeDomain = async (id: string) => {
    try {
      // Path-notation null erases the entry; sibling entries in the record are preserved.
      await project.updateConfig({ [`domains.trustedDomains.${id}`]: null })
      await invalidateProjectConfig(project.id)
      toast.success("Trusted domain removed.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove domain.")
    }
  }

  if (domains.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
        No trusted domains yet. Add one below to enable production sign-in callbacks.
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-md border">
      {domains.map((domain) => (
        <li
          key={domain.id}
          className="flex items-center justify-between gap-3 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs">
              {domain.baseUrl}
              <span className="text-muted-foreground">{domain.handlerPath}</span>
            </p>
            <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              {domain.id}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${domain.baseUrl}`}
            onClick={() => {
              void removeDomain(domain.id)
            }}
          >
            <TrashIcon />
          </Button>
        </li>
      ))}
    </ul>
  )
}

function AddDomainForm({ existingIds }: { existingIds: Array<string> }) {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()

  const [baseUrl, setBaseUrl] = useState("")
  const [handlerPath, setHandlerPath] = useState("/handler")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const newId = useMemo(() => {
    // Stable, deterministic-ish id that won't collide with existing keys. Use crypto.randomUUID
    // when available; fall back to a counter-based id only if the runtime lacks it.
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    let i = existingIds.length
    while (existingIds.includes(`domain-${i}`)) i += 1
    return `domain-${i}`
    // We want a fresh id whenever the set of existing ids changes (typically: after a successful
    // add). Recomputing on `existingIds.length` is sufficient and avoids referential-stability
    // churn from the array prop.
  }, [existingIds])

  const onSubmit = async () => {
    const trimmedUrl = baseUrl.trim()
    const trimmedPath = handlerPath.trim()
    if (trimmedUrl.length === 0) {
      setError("Domain URL is required.")
      return
    }
    if (trimmedPath.length === 0) {
      setError("Handler path is required.")
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await project.updateConfig({
        [`domains.trustedDomains.${newId}`]: {
          baseUrl: trimmedUrl,
          handlerPath: trimmedPath,
        },
      })
      await invalidateProjectConfig(project.id)
      toast.success("Trusted domain added.")
      setBaseUrl("")
      setHandlerPath("/handler")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add domain.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        Add domain
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <Input
          placeholder="https://example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          disabled={submitting}
        />
        <Input
          placeholder="/handler"
          value={handlerPath}
          onChange={(e) => setHandlerPath(e.target.value)}
          disabled={submitting}
        />
        <Button
          type="button"
          disabled={submitting || baseUrl.trim().length === 0}
          onClick={onSubmit}
        >
          <PlusIcon /> Add
        </Button>
      </div>
      {error != null ? (
        <Alert variant="destructive">
          <WarningOctagonIcon />
          <AlertTitle>Could not add domain</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Danger zone                                                         */
/* ------------------------------------------------------------------ */

function DangerZoneCard() {
  const adminApp = useAdminApp()
  const project = useAdminProject(adminApp)
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const canDelete = confirmation === project.displayName

  const onDelete = async () => {
    if (!canDelete) return
    setError(null)
    setDeleting(true)
    try {
      await project.delete()
      // Don't toast here — the page is unmounting. Navigate away first.
      await navigate({ to: "/projects" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project.")
      setDeleting(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-medium tracking-tight text-destructive">
        Danger zone
      </h2>
      <Card className="border-destructive/40 bg-destructive/[0.02]">
        <CardHeader>
          <CardTitle>Delete project</CardTitle>
          <CardDescription>
            Permanently deletes this project, its users, teams, API keys, and configuration.
            This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next)
              if (!next) {
                setConfirmation("")
                setError(null)
              }
            }}
          >
            <AlertDialogTrigger
              render={
                <Button variant="destructive">
                  <TrashIcon />
                  Delete project
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {project.displayName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the project and all of its data. To confirm,
                  type the project's display name below.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="delete-project-confirm">
                  Type <span className="font-mono text-foreground">{project.displayName}</span> to confirm
                </Label>
                <Input
                  id="delete-project-confirm"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                  disabled={deleting}
                />
                {error != null ? (
                  <Alert variant="destructive">
                    <WarningOctagonIcon />
                    <AlertTitle>Deletion failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={!canDelete || deleting}
                  onClick={onDelete}
                >
                  {deleting ? "Deleting…" : "Delete project"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function ReadOnlyRow({
  label,
  children,
}: {
  label: string,
  children: React.ReactNode,
}) {
  return (
    <div className="space-y-1">
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
    <div className="flex items-center gap-2">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy project ID"}
        onClick={() => {
          void onCopy()
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
