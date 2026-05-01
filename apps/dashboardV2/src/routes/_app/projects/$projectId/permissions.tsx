import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { DotsThreeIcon, PlusIcon, ShieldIcon } from "@phosphor-icons/react"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useProjectPermissionDefinitionsQuery,
  useStackAuthQueryInvalidation,
  useTeamPermissionDefinitionsQuery,
} from "@/lib/stack/react-query"

export const Route = createFileRoute("/_app/projects/$projectId/permissions")({
  component: PermissionsPage,
})

/**
 * Minimal slug regex: lowercase + digits + `_`/`-`/`:`/`$`, length 1+.
 * Server enforces its own rules; this is a friendly client-side guard so the
 * user gets immediate feedback before submitting.
 */
const PERMISSION_ID_RE = /^[a-z0-9_:$-]+$/

type PermissionDef = {
  id: string,
  description?: string,
  containedPermissionIds: Array<string>,
}

type PermissionDefinitionKind = "team" | "project"

type PermissionsSectionProps = {
  /** UI label, e.g. "Team permissions". */
  label: string,
  /** Singular form, e.g. "team permission". */
  singular: string,
  kind: PermissionDefinitionKind,
  useDefinitions: () => { data: Array<PermissionDef> | undefined },
  /** Create a new permission definition. Throws on failure. */
  create: (data: {
    id: string,
    description?: string,
    containedPermissionIds: Array<string>,
  }) => Promise<unknown>,
  /**
   * Update an existing permission definition. The SDK does *not* accept an id
   * rename, so callers should treat `id` as immutable in the edit dialog.
   */
  update: (
    permissionId: string,
    data: {
      description?: string,
      containedPermissionIds: Array<string>,
    },
  ) => Promise<unknown>,
  /** Delete a permission definition by id. Throws on failure. */
  remove: (permissionId: string) => Promise<unknown>,
}

function PermissionsPage() {
  const adminApp = useAdminApp()

  return (
    <ProjectPage>
      <ProjectPageHeader title="Permissions" />

      <ProjectPageMain className="space-y-6">
        <Tabs defaultValue="team">
          <TabsList>
            <TabsTrigger value="team">Team permissions</TabsTrigger>
            <TabsTrigger value="project">Project permissions</TabsTrigger>
          </TabsList>

          <TabsContent value="team" className="mt-6">
            <PermissionsSection
              label="Team permissions"
              singular="team permission"
              kind="team"
              useDefinitions={() => useTeamPermissionDefinitionsQuery(adminApp)}
              create={(data) => adminApp.createTeamPermissionDefinition(data)}
              update={(id, data) => adminApp.updateTeamPermissionDefinition(id, data)}
              remove={(id) => adminApp.deleteTeamPermissionDefinition(id)}
            />
          </TabsContent>

          <TabsContent value="project" className="mt-6">
            <PermissionsSection
              label="Project permissions"
              singular="project permission"
              kind="project"
              useDefinitions={() => useProjectPermissionDefinitionsQuery(adminApp)}
              create={(data) => adminApp.createProjectPermissionDefinition(data)}
              update={(id, data) => adminApp.updateProjectPermissionDefinition(id, data)}
              remove={(id) => adminApp.deleteProjectPermissionDefinition(id)}
            />
          </TabsContent>
        </Tabs>
      </ProjectPageMain>
    </ProjectPage>
  )
}

function PermissionsSection({
  label,
  singular,
  kind,
  useDefinitions,
  create,
  update,
  remove,
}: PermissionsSectionProps) {
  const adminApp = useAdminApp()
  const { invalidatePermissionDefinitions } = useStackAuthQueryInvalidation()
  const definitionsQuery = useDefinitions()
  const definitions = definitionsQuery.data
  const visibleDefinitions = definitions ?? []
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<PermissionDef | null>(null)
  const [deleting, setDeleting] = React.useState<PermissionDef | null>(null)

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-heading text-sm font-medium tracking-tight">
            {label}
          </h2>
          <span className="font-mono text-[11px] tracking-wider text-muted-foreground">
            {definitions == null ? "..." : definitions.length}
          </span>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New
        </Button>
      </div>

      {definitions == null ? (
        <PermissionsSectionSkeleton />
      ) : definitions.length === 0 ? (
        <Empty className="rounded-lg ring-1 ring-foreground/10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldIcon />
            </EmptyMedia>
            <EmptyTitle>No {label.toLowerCase()} yet</EmptyTitle>
            <EmptyDescription>
              Create your first {singular} to start gating access in your app.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
          {definitions.map((def) => (
            <li
              key={def.id}
              className="flex items-start justify-between gap-4 p-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {def.id}
                </code>
                {def.description ? (
                  <p className="text-sm text-muted-foreground">
                    {def.description}
                  </p>
                ) : null}
                {def.containedPermissionIds.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1 pt-1">
                    <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                      Contains
                    </span>
                    {def.containedPermissionIds.map((cid) => (
                      <Badge key={cid} variant="secondary" className="font-mono">
                        {cid}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${def.id}`}
                    />
                  }
                >
                  <DotsThreeIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(def)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive data-highlighted:text-destructive"
                    onClick={() => setDeleting(def)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <PermissionFormDialog
        mode="create"
        singular={singular}
        open={createOpen}
        onOpenChange={setCreateOpen}
        existing={visibleDefinitions}
        onSubmit={async ({ id, description, containedPermissionIds }) => {
          await create({ id, description, containedPermissionIds })
          await invalidatePermissionDefinitions(adminApp.projectId, kind)
        }}
      />

      <PermissionFormDialog
        mode="edit"
        singular={singular}
        open={editing != null}
        onOpenChange={(o) => {
          if (!o) setEditing(null)
        }}
        existing={visibleDefinitions}
        initial={editing}
        onSubmit={async ({ id, description, containedPermissionIds }) => {
          await update(id, { description, containedPermissionIds })
          await invalidatePermissionDefinitions(adminApp.projectId, kind)
        }}
      />

      <AlertDialog
        open={deleting != null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {singular}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {deleting?.id}
              </code>
              . Code that checks for this permission will stop matching. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const target = deleting
                if (target == null) return
                await remove(target.id)
                await invalidatePermissionDefinitions(adminApp.projectId, kind)
                setDeleting(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function PermissionsSectionSkeleton() {
  return (
    <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-36 rounded-md" />
            <Skeleton className="h-4 w-full max-w-md" />
            <div className="flex gap-1 pt-1">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
          <Skeleton className="size-8 rounded-md" />
        </li>
      ))}
    </ul>
  )
}

type PermissionFormDialogProps = {
  mode: "create" | "edit",
  singular: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  existing: Array<PermissionDef>,
  initial?: PermissionDef | null,
  onSubmit: (data: {
    id: string,
    description?: string,
    containedPermissionIds: Array<string>,
  }) => Promise<void>,
}

function PermissionFormDialog({
  mode,
  singular,
  open,
  onOpenChange,
  existing,
  initial,
  onSubmit,
}: PermissionFormDialogProps) {
  const [id, setId] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [contained, setContained] = React.useState<Array<string>>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Sync form state when the dialog opens or the target row changes.
  React.useEffect(() => {
    if (!open) return
    setId(initial?.id ?? "")
    setDescription(initial?.description ?? "")
    setContained(initial?.containedPermissionIds ?? [])
    setError(null)
  }, [open, initial])

  const isEdit = mode === "edit"
  const lockedId = isEdit
  // Choices for the multi-select: any existing permission *other* than the one
  // being edited (a permission cannot contain itself).
  const choices = existing.filter((p) => p.id !== initial?.id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedId = id.trim()
    const trimmedDescription = description.trim()

    if (trimmedId.length === 0) {
      setError("ID is required.")
      return
    }
    if (!PERMISSION_ID_RE.test(trimmedId)) {
      setError(
        "ID must contain only lowercase letters, numbers, and `_`, `-`, `:`, `$`.",
      )
      return
    }
    if (
      !isEdit &&
      existing.some((p) => p.id === trimmedId)
    ) {
      setError(`A ${singular} with this ID already exists.`)
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        id: trimmedId,
        description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
        containedPermissionIds: contained,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${singular}.`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? `Edit ${singular}` : `New ${singular}`}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? `Update this ${singular}'s description and contained permissions. The ID cannot be changed.`
                : `Define a new ${singular}. You can include other permissions to compose roles.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="permission-id">ID</Label>
              <Input
                id="permission-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. read_secrets"
                autoFocus={!isEdit}
                disabled={lockedId}
                required
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase, numbers, and <code>_</code>/<code>-</code>/<code>:</code>/<code>$</code> only.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="permission-description">
                Description{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="permission-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this permission grant?"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Contained permissions</Label>
              <ContainedPermissionsSelect
                choices={choices}
                value={contained}
                onChange={setContained}
                singular={singular}
              />
              <p className="text-[11px] text-muted-foreground">
                Holders of this permission also implicitly hold the selected
                permissions.
              </p>
            </div>

            {error != null ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type ContainedPermissionsSelectProps = {
  choices: Array<PermissionDef>,
  value: Array<string>,
  onChange: (next: Array<string>) => void,
  singular: string,
}

function ContainedPermissionsSelect({
  choices,
  value,
  onChange,
  singular,
}: ContainedPermissionsSelectProps) {
  const [open, setOpen] = React.useState(false)
  const valueSet = React.useMemo(() => new Set(value), [value])

  const toggle = (id: string) => {
    if (valueSet.has(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  const summary =
    value.length === 0
      ? "Select permissions"
      : `${value.length} selected`

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between font-normal"
            >
              <span
                className={
                  value.length === 0 ? "text-muted-foreground" : undefined
                }
              >
                {summary}
              </span>
            </Button>
          }
        />
        <PopoverContent
          align="start"
          className="w-[--anchor-width] p-0"
        >
          <Command>
            <CommandInput placeholder={`Search ${singular}s…`} />
            <CommandList>
              <CommandEmpty>
                {choices.length === 0
                  ? `No other ${singular}s defined yet.`
                  : "No matches."}
              </CommandEmpty>
              <CommandGroup>
                {choices.map((c) => {
                  const checked = valueSet.has(c.id)
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => toggle(c.id)}
                      data-checked={checked}
                    >
                      <span className="font-mono text-xs">{c.id}</span>
                      {c.description ? (
                        <span className="ms-2 truncate text-[11px] text-muted-foreground">
                          {c.description}
                        </span>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="font-mono">
              {v}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
