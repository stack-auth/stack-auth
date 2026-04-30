import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { EnvelopeIcon, MagicWandIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAdminApp } from "@/lib/stack/admin-app"

export const Route = createFileRoute("/_app/projects/$projectId/emails/templates")({
  component: TemplatesPage,
})

const NO_THEME_VALUE = "__no_theme__"

function TemplatesPage() {
  const adminApp = useAdminApp()
  const templates = adminApp.useEmailTemplates()
  const themes = adminApp.useEmailThemes()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Auto-select first template once loaded.
  useEffect(() => {
    if (selectedId == null && templates.length > 0) {
      setSelectedId(templates[0].id)
    }
  }, [selectedId, templates])

  const themesById = useMemo(() => {
    const m = new Map<string, { id: string, displayName: string }>()
    for (const t of themes) m.set(t.id, t)
    return m
  }, [themes])

  const selected = selectedId == null
    ? null
    : templates.find((t) => t.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-base font-medium tracking-tight">
            Email templates
          </h2>
          <Badge variant="outline">{templates.length}</Badge>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <TemplatesEmpty onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className="flex flex-col gap-1 self-start rounded-md ring-1 ring-foreground/10">
            {templates.map((t) => {
              const active = t.id === selectedId
              const themeName =
                t.themeId != null
                  ? themesById.get(t.themeId)?.displayName ?? t.themeId
                  : null
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
                    <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      {t.id.slice(0, 8)}
                      {themeName ? (
                        <Badge variant="outline" className="font-mono">
                          {themeName}
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="min-w-0">
            {selected == null ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Select a template to edit.
              </p>
            ) : (
              <TemplateEditor
                key={selected.id}
                templateId={selected.id}
                initialDisplayName={selected.displayName}
                initialThemeId={selected.themeId ?? null}
                initialTsxSource={selected.tsxSource}
                themes={themes}
                onDeleted={() => setSelectedId(null)}
              />
            )}
          </div>
        </div>
      )}

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  )
}

function TemplatesEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EnvelopeIcon />
          </EmptyMedia>
          <EmptyTitle>No templates yet</EmptyTitle>
          <EmptyDescription>
            Templates are reusable TSX sources rendered to HTML with a chosen
            theme. Create one to get started.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon />
            New template
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function CreateTemplateDialog({
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
      const { id } = await adminApp.createEmailTemplate(name)
      toast.success(`Template "${name}" created.`)
      reset()
      onOpenChange(false)
      onCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create template.")
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
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              You can customize the TSX source and theme afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Display name</Label>
              <Input
                id="template-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Welcome email"
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
              {submitting ? "Creating…" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TemplateEditor({
  templateId,
  initialDisplayName,
  initialThemeId,
  initialTsxSource,
  themes,
  onDeleted,
}: {
  templateId: string,
  initialDisplayName: string,
  initialThemeId: string | null,
  initialTsxSource: string,
  themes: Array<{ id: string, displayName: string }>,
  onDeleted: () => void,
}) {
  const adminApp = useAdminApp()
  const [tsxSource, setTsxSource] = useState(initialTsxSource)
  const [themeIdValue, setThemeIdValue] = useState<string>(
    initialThemeId ?? NO_THEME_VALUE
  )
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Note: displayName is shown read-only because the SDK's
  // `updateEmailTemplate(id, tsxSource, themeId)` does not accept a display
  // name. Renaming is not currently exposed by the SDK.

  const dirty =
    tsxSource !== initialTsxSource ||
    (themeIdValue === NO_THEME_VALUE ? null : themeIdValue) !== initialThemeId

  // Fetch a sandboxed live preview against the SAVED state (not the dirty
  // textarea) — re-rendering on every keystroke would hammer the server. Save
  // to refresh the preview.
  const previewHtml = adminApp.useEmailPreview({ templateId })

  const handleSave = async () => {
    setError(null)
    const themeIdToSend: string | null =
      themeIdValue === NO_THEME_VALUE ? null : themeIdValue
    try {
      await adminApp.updateEmailTemplate(templateId, tsxSource, themeIdToSend)
      toast.success("Template saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template.")
    }
  }

  const handleRewriteWithAi = async () => {
    setError(null)
    try {
      const { tsxSource: rewritten } = await adminApp.rewriteTemplateSourceWithAI(tsxSource)
      setTsxSource(rewritten)
      toast.success("AI rewrite applied. Review and save.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rewrite template.")
    }
  }

  const handleDelete = async () => {
    try {
      await adminApp.deleteEmailTemplate(templateId)
      toast.success("Template deleted.")
      setDeleteOpen(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete template.")
      setDeleteOpen(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md ring-1 ring-foreground/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Editing
          </p>
          <h3 className="truncate font-heading text-base font-medium">
            {initialDisplayName}
          </h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            {templateId}
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

      <div className="space-y-1.5">
        <Label htmlFor="template-theme">Theme</Label>
        <Select
          value={themeIdValue}
          onValueChange={(v) => {
            if (typeof v === "string") setThemeIdValue(v)
          }}
        >
          <SelectTrigger id="template-theme" className="w-full">
            <SelectValue placeholder="Default theme" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_THEME_VALUE}>Default theme</SelectItem>
            {themes.map((th) => (
              <SelectItem key={th.id} value={th.id}>
                {th.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="template-source">TSX source</Label>
          <Textarea
            id="template-source"
            value={tsxSource}
            onChange={(e) => setTsxSource(e.target.value)}
            spellCheck={false}
            className="min-h-[420px] font-mono text-[11px] leading-relaxed"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Preview (saved state)</Label>
          <iframe
            title="Email preview"
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

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={handleRewriteWithAi}>
          <MagicWandIcon />
          Rewrite with AI
        </Button>
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The template "{initialDisplayName}"
              will be permanently removed.
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
