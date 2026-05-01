import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { PaintBrushIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails"
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
import { CodeEditor } from "@/components/projects/emails/code-editor"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useEmailPreviewQuery,
  useEmailThemeQuery,
  useEmailThemesQuery,
  useStackAuthQueryInvalidation,
} from "@/lib/stack/react-query"

export const Route = createFileRoute("/_app/projects/$projectId/emails/themes")({
  component: ThemesPage,
})

function ThemesPage() {
  const adminApp = useAdminApp()
  const themes = useEmailThemesQuery(adminApp).data ?? []
  const { invalidateEmailThemes } = useStackAuthQueryInvalidation()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [themePendingDeleteId, setThemePendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId == null && themes.length > 0) {
      setSelectedId(themes[0].id)
    }
  }, [selectedId, themes])

  const selected = selectedId == null
    ? null
    : themes.find((t) => t.id === selectedId) ?? null

  const themePendingDelete = themePendingDeleteId == null
    ? null
    : themes.find((t) => t.id === themePendingDeleteId) ?? null

  const handleDeleteTheme = async () => {
    if (themePendingDelete == null) {
      throw new Error("Tried to delete an email theme without a selected theme.")
    }

    setDeleteError(null)
    await adminApp.deleteEmailTheme(themePendingDelete.id)
    await invalidateEmailThemes(adminApp.projectId)
    toast.success("Theme deleted.")
    setThemePendingDeleteId(null)
    setSelectedId((currentSelectedId) =>
      currentSelectedId === themePendingDelete.id ? null : currentSelectedId
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {themes.length === 0 ? (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <EmailListHeader
            title="Email themes"
            count={themes.length}
            actionLabel="New theme"
            onCreate={() => setCreateOpen(true)}
          />
          <ThemesEmpty onCreate={() => setCreateOpen(true)} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            <EmailListHeader
              title="Email themes"
              count={themes.length}
              actionLabel="New theme"
              onCreate={() => setCreateOpen(true)}
            />
            {deleteError != null ? (
              <Alert variant="destructive">
                <AlertTitle>Could not delete theme</AlertTitle>
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-md ring-1 ring-foreground/10">
              {themes.map((t) => {
                const active = t.id === selectedId
                return (
                  <li key={t.id}>
                    <div
                      className={
                        "flex w-full items-start gap-1 rounded-md px-2 py-2 transition-colors hover:transition-none " +
                        (active
                          ? "bg-accent text-foreground"
                          : "hover:bg-accent/40")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(t.id)}
                        className="min-w-0 flex-1 text-start"
                      >
                        <span className="block truncate text-xs font-medium">
                          {t.displayName}
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                          {t.id.slice(0, 8)}
                        </span>
                      </button>
                      {active ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete theme ${t.displayName}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setThemePendingDeleteId(t.id)}
                        >
                          <TrashIcon />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            {selected == null ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Select a theme to edit.
              </p>
            ) : (
              <ThemeEditor
                key={selected.id}
                themeId={selected.id}
              />
            )}
          </div>
        </div>
      )}

      <CreateThemeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      <AlertDialog
        open={themePendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setThemePendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this theme?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Templates using "{themePendingDelete?.displayName}"
              will fall back to the default theme.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                try {
                  await handleDeleteTheme()
                } catch (err) {
                  setDeleteError(err instanceof Error ? err.message : "Failed to delete theme.")
                  setThemePendingDeleteId(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EmailListHeader({
  title,
  count,
  actionLabel,
  onCreate,
}: {
  title: string,
  count: number,
  actionLabel: string,
  onCreate: () => void,
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate font-heading text-sm font-medium tracking-tight">
          {title}
        </h2>
        <Badge variant="outline">{count}</Badge>
      </div>
      <Button size="sm" onClick={onCreate}>
        <PlusIcon />
        {actionLabel}
      </Button>
    </div>
  )
}

function ThemesEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PaintBrushIcon />
          </EmptyMedia>
          <EmptyTitle>No themes yet</EmptyTitle>
          <EmptyDescription>
            Themes wrap templates with shared layout and styling. Create one to
            give your emails a consistent look.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon />
            New theme
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function CreateThemeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean,
  onOpenChange: (nextOpen: boolean) => void,
  onCreated: (id: string) => void,
}) {
  const adminApp = useAdminApp()
  const { invalidateEmailThemes } = useStackAuthQueryInvalidation()
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setDisplayName("")
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = displayName.trim()
    if (!name) {
      setError("Display name is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { id } = await adminApp.createEmailTheme(name)
      await invalidateEmailThemes(adminApp.projectId)
      toast.success(`Theme "${name}" created.`)
      reset()
      onOpenChange(false)
      onCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create theme.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New theme</DialogTitle>
            <DialogDescription>
              Display name is set on creation and cannot be edited later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="theme-name">Display name</Label>
              <Input
                id="theme-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Default brand"
                autoFocus
                required
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
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create theme"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ThemeEditor({
  themeId,
}: {
  themeId: string,
}) {
  const adminApp = useAdminApp()
  const themeQuery = useEmailThemeQuery(themeId, adminApp)
  const theme = themeQuery.data
  const { invalidateEmailThemes } = useStackAuthQueryInvalidation()
  const [tsxSource, setTsxSource] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Resync local source if the underlying theme changes (e.g. another
  // tab edited it). React to id-change is implicit via key= in parent;
  // this catches in-place updates.
  useEffect(() => {
    if (theme != null) {
      setTsxSource(theme.tsxSource)
    }
  }, [theme])

  // Preview the saved theme against the same default sample template used by
  // the legacy dashboard and onboarding flow.
  const previewQuery = useEmailPreviewQuery({
    themeId,
    templateTsxSource: previewTemplateSource,
  }, adminApp)
  const previewHtml = previewQuery.data ?? ""

  if (themeQuery.isPending) {
    return (
      <div className="grid h-full min-h-0 place-items-center rounded-md p-3 ring-1 ring-foreground/10">
        <p className="text-xs text-muted-foreground">Loading theme...</p>
      </div>
    )
  }

  if (themeQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load theme</AlertTitle>
        <AlertDescription>{getErrorMessage(themeQuery.error)}</AlertDescription>
      </Alert>
    )
  }

  if (theme == null) {
    throw new Error("Theme query finished without returning theme data.")
  }

  const dirty = tsxSource !== theme.tsxSource

  const handleSave = async () => {
    setError(null)
    try {
      await adminApp.updateEmailTheme(themeId, tsxSource)
      await invalidateEmailThemes(adminApp.projectId)
      toast.success("Theme saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save theme.")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-md p-3 ring-1 ring-foreground/10">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-1.5">
          <Label htmlFor="theme-source">TSX source</Label>
          <CodeEditor
            ariaLabel="Theme TSX source"
            value={tsxSource}
            onChange={setTsxSource}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-1.5">
          <Label>Preview (saved state)</Label>
          {previewQuery.isPending ? (
            <div className="grid min-h-0 w-full flex-1 place-items-center rounded-md bg-white text-xs text-muted-foreground ring-1 ring-foreground/10">
              Rendering preview...
            </div>
          ) : previewQuery.isError ? (
            <Alert variant="destructive" className="min-h-0 flex-1">
              <AlertTitle>Could not render preview</AlertTitle>
              <AlertDescription>{getErrorMessage(previewQuery.error)}</AlertDescription>
            </Alert>
          ) : (
            <iframe
              title="Theme preview"
              srcDoc={previewHtml}
              sandbox=""
              className="min-h-0 w-full flex-1 rounded-md bg-white ring-1 ring-foreground/10"
            />
          )}
        </div>
      </div>

      {error != null ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex shrink-0 items-center justify-end">
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
      </div>

    </div>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return "Unknown error"
}
