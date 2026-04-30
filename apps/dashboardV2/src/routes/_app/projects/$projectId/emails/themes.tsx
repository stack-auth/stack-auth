import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { PaintBrushIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
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
import { Textarea } from "@/components/ui/textarea"
import { useAdminApp } from "@/lib/stack/admin-app"

export const Route = createFileRoute("/_app/projects/$projectId/emails/themes")({
  component: ThemesPage,
})

function ThemesPage() {
  const adminApp = useAdminApp()
  const themes = adminApp.useEmailThemes()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId == null && themes.length > 0) {
      setSelectedId(themes[0].id)
    }
  }, [selectedId, themes])

  const selected = selectedId == null
    ? null
    : themes.find((t) => t.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-base font-medium tracking-tight">
            Email themes
          </h2>
          <Badge variant="outline">{themes.length}</Badge>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New theme
        </Button>
      </div>

      {themes.length === 0 ? (
        <ThemesEmpty onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className="flex flex-col gap-1 self-start rounded-md ring-1 ring-foreground/10">
            {themes.map((t) => {
              const active = t.id === selectedId
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={
                      "flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-start transition-colors hover:transition-none " +
                      (active
                        ? "bg-accent text-foreground"
                        : "hover:bg-accent/40")
                    }
                  >
                    <span className="truncate text-xs font-medium">
                      {t.displayName}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {t.id.slice(0, 8)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="min-w-0">
            {selected == null ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Select a theme to edit.
              </p>
            ) : (
              <ThemeEditor
                key={selected.id}
                themeId={selected.id}
                onDeleted={() => setSelectedId(null)}
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
  onOpenChange: (open: boolean) => void,
  onCreated: (id: string) => void,
}) {
  const adminApp = useAdminApp()
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
  onDeleted,
}: {
  themeId: string,
  onDeleted: () => void,
}) {
  const adminApp = useAdminApp()
  const theme = adminApp.useEmailTheme(themeId)
  const [tsxSource, setTsxSource] = useState(theme.tsxSource)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Resync local source if the underlying theme changes (e.g. another
  // tab edited it). React to id-change is implicit via key= in parent;
  // this catches in-place updates.
  useEffect(() => {
    setTsxSource(theme.tsxSource)
  }, [theme.tsxSource])

  // Preview the SAVED theme against a default template (no template id =
  // SDK-default sample). Refreshes after save.
  const previewHtml = adminApp.useEmailPreview({ themeId })

  const dirty = tsxSource !== theme.tsxSource

  const handleSave = async () => {
    setError(null)
    try {
      await adminApp.updateEmailTheme(themeId, tsxSource)
      toast.success("Theme saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save theme.")
    }
  }

  const handleDelete = async () => {
    try {
      await adminApp.deleteEmailTheme(themeId)
      toast.success("Theme deleted.")
      setDeleteOpen(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete theme.")
      setDeleteOpen(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Editing
          </p>
          {/*
            Display name is read-only because the SDK exposes
            updateEmailTheme(id, tsxSource) without a name field.
          */}
          <h3 className="truncate font-heading text-base font-medium">
            {theme.displayName}
          </h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            {themeId}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <TrashIcon />
          Delete
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="theme-source">TSX source</Label>
          <Textarea
            id="theme-source"
            value={tsxSource}
            onChange={(e) => setTsxSource(e.target.value)}
            spellCheck={false}
            className="min-h-[420px] font-mono text-[11px] leading-relaxed"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Preview (saved state)</Label>
          <iframe
            title="Theme preview"
            srcDoc={previewHtml}
            sandbox=""
            className="h-[420px] w-full rounded-md bg-white ring-1 ring-foreground/10"
          />
        </div>
      </div>

      {error != null ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-end">
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this theme?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Templates using "{theme.displayName}"
              will fall back to the default theme.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
