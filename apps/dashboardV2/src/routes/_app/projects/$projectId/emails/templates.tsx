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
import { CodeEditor } from "@/components/projects/emails/code-editor"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useEmailPreviewQuery,
  useEmailTemplatesQuery,
  useEmailThemesQuery,
  useStackAuthQueryInvalidation,
} from "@/lib/stack/react-query"

export const Route = createFileRoute("/_app/projects/$projectId/emails/templates")({
  component: TemplatesPage,
})

const NO_THEME_VALUE = "__no_theme__"

function getThemeSelectLabel(
  value: unknown,
  themes: Array<{ id: string, displayName: string }>
) {
  if (value === NO_THEME_VALUE) {
    return "Default theme"
  }
  if (typeof value !== "string") {
    throw new Error("Expected email template theme select value to be a string.")
  }
  return themes.find((theme) => theme.id === value)?.displayName ?? value
}

function TemplatesPage() {
  const adminApp = useAdminApp()
  const templates = useEmailTemplatesQuery(adminApp).data ?? []
  const themes = useEmailThemesQuery(adminApp).data ?? []
  const { invalidateEmailTemplates } = useStackAuthQueryInvalidation()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [templatePendingDeleteId, setTemplatePendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  const templatePendingDelete = templatePendingDeleteId == null
    ? null
    : templates.find((t) => t.id === templatePendingDeleteId) ?? null

  const handleDeleteTemplate = async () => {
    if (templatePendingDelete == null) {
      throw new Error("Tried to delete an email template without a selected template.")
    }

    setDeleteError(null)
    await adminApp.deleteEmailTemplate(templatePendingDelete.id)
    await invalidateEmailTemplates(adminApp.projectId)
    toast.success("Template deleted.")
    setTemplatePendingDeleteId(null)
    setSelectedId((currentSelectedId) =>
      currentSelectedId === templatePendingDelete.id ? null : currentSelectedId
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {templates.length === 0 ? (
        <div className="flex h-full min-h-0 flex-col gap-4">
          <EmailListHeader
            title="Email templates"
            count={templates.length}
            actionLabel="New template"
            onCreate={() => setCreateOpen(true)}
          />
          <TemplatesEmpty onCreate={() => setCreateOpen(true)} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            <EmailListHeader
              title="Email templates"
              count={templates.length}
              actionLabel="New template"
              onCreate={() => setCreateOpen(true)}
            />
            {deleteError != null ? (
              <Alert variant="destructive">
                <AlertTitle>Could not delete template</AlertTitle>
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded-md ring-1 ring-foreground/10">
              {templates.map((t) => {
                const active = t.id === selectedId
                const themeName =
                  t.themeId != null
                    ? themesById.get(t.themeId)?.displayName ?? t.themeId
                    : null
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
                        <span className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                          {t.id.slice(0, 8)}
                          {themeName ? (
                            <Badge variant="outline" className="font-mono">
                              {themeName}
                            </Badge>
                          ) : null}
                        </span>
                      </button>
                      {active ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete template ${t.displayName}`}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setTemplatePendingDeleteId(t.id)}
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
                Select a template to edit.
              </p>
            ) : (
              <TemplateEditor
                key={selected.id}
                templateId={selected.id}
                initialThemeId={selected.themeId ?? null}
                initialTsxSource={selected.tsxSource}
                themes={themes}
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

      <AlertDialog
        open={templatePendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setTemplatePendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The template "{templatePendingDelete?.displayName}"
              will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                try {
                  await handleDeleteTemplate()
                } catch (err) {
                  setDeleteError(err instanceof Error ? err.message : "Failed to delete template.")
                  setTemplatePendingDeleteId(null)
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
  onOpenChange: (nextOpen: boolean) => void,
  onCreated: (id: string) => void,
}) {
  const adminApp = useAdminApp()
  const { invalidateEmailTemplates } = useStackAuthQueryInvalidation()
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
      await invalidateEmailTemplates(adminApp.projectId)
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
  initialThemeId,
  initialTsxSource,
  themes,
}: {
  templateId: string,
  initialThemeId: string | null,
  initialTsxSource: string,
  themes: Array<{ id: string, displayName: string }>,
}) {
  const adminApp = useAdminApp()
  const { invalidateEmailTemplates } = useStackAuthQueryInvalidation()
  const [tsxSource, setTsxSource] = useState(initialTsxSource)
  const [themeIdValue, setThemeIdValue] = useState<string>(
    initialThemeId ?? NO_THEME_VALUE
  )
  const [error, setError] = useState<string | null>(null)

  const dirty =
    tsxSource !== initialTsxSource ||
    (themeIdValue === NO_THEME_VALUE ? null : themeIdValue) !== initialThemeId

  // Fetch a sandboxed live preview against the SAVED state (not the dirty
  // textarea) — re-rendering on every keystroke would hammer the server. Save
  // to refresh the preview.
  const previewHtml = useEmailPreviewQuery({ templateId }, adminApp).data ?? ""

  const handleSave = async () => {
    setError(null)
    const themeIdToSend: string | null =
      themeIdValue === NO_THEME_VALUE ? null : themeIdValue
    try {
      await adminApp.updateEmailTemplate(templateId, tsxSource, themeIdToSend)
      await invalidateEmailTemplates(adminApp.projectId)
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-md p-3 ring-1 ring-foreground/10">
      <div className="grid shrink-0 gap-2 lg:grid-cols-[4rem_minmax(0,1fr)] lg:items-center">
        <Label htmlFor="template-theme" className="text-xs">Theme</Label>
        <Select
          value={themeIdValue}
          onValueChange={(v) => {
            if (typeof v === "string") setThemeIdValue(v)
          }}
        >
          <SelectTrigger id="template-theme" className="h-8 w-full">
            <SelectValue placeholder="Default theme">
              {(value: unknown) => getThemeSelectLabel(value, themes)}
            </SelectValue>
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-1.5">
          <Label htmlFor="template-source">TSX source</Label>
          <CodeEditor
            ariaLabel="Template TSX source"
            value={tsxSource}
            onChange={setTsxSource}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-1.5">
          <Label>Preview (saved state)</Label>
          <iframe
            title="Email preview"
            srcDoc={previewHtml}
            sandbox=""
            className="min-h-0 w-full flex-1 rounded-md bg-white ring-1 ring-foreground/10"
          />
        </div>
      </div>

      {error != null ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex shrink-0 items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={handleRewriteWithAi}>
          <MagicWandIcon />
          Rewrite with AI
        </Button>
        <Button onClick={handleSave} disabled={!dirty}>
          Save
        </Button>
      </div>

    </div>
  )
}
