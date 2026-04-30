import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { CheckCircleIcon, EnvelopeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
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

export const Route = createFileRoute("/_app/projects/$projectId/emails/drafts")({
  component: DraftsPage,
})

const NO_THEME_VALUE = "__no_theme__"

type Draft = {
  id: string,
  displayName: string,
  themeId: string | undefined | false,
  tsxSource: string,
  sentAt: Date | null,
}

function DraftsPage() {
  const adminApp = useAdminApp()
  const drafts = adminApp.useEmailDrafts()
  const themes = adminApp.useEmailThemes()

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sortedDrafts = useMemo(() => {
    // Unsent drafts first, then sent. Stable within group.
    const unsent: Array<Draft> = []
    const sent: Array<Draft> = []
    for (const d of drafts) {
      if (d.sentAt == null) unsent.push(d)
      else sent.push(d)
    }
    return [...unsent, ...sent]
  }, [drafts])

  useEffect(() => {
    if (selectedId == null && sortedDrafts.length > 0) {
      setSelectedId(sortedDrafts[0].id)
    }
  }, [selectedId, sortedDrafts])

  const themesById = useMemo(() => {
    const m = new Map<string, { id: string, displayName: string }>()
    for (const t of themes) m.set(t.id, t)
    return m
  }, [themes])

  const selected = selectedId == null
    ? null
    : sortedDrafts.find((d) => d.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-base font-medium tracking-tight">
            Email drafts
          </h2>
          <Badge variant="outline">{drafts.length}</Badge>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New draft
        </Button>
      </div>

      {drafts.length === 0 ? (
        <DraftsEmpty onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
          <ul className="flex flex-col gap-1 self-start rounded-md ring-1 ring-foreground/10">
            {sortedDrafts.map((d) => {
              const active = d.id === selectedId
              const themeName =
                typeof d.themeId === "string"
                  ? themesById.get(d.themeId)?.displayName ?? d.themeId
                  : null
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={
                      "flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-start transition-colors hover:transition-none " +
                      (active
                        ? "bg-accent text-foreground"
                        : "hover:bg-accent/40")
                    }
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {d.displayName}
                      </span>
                      {d.sentAt != null ? (
                        <Badge variant="secondary" className="shrink-0 gap-1">
                          <CheckCircleIcon />
                          Sent
                        </Badge>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      {d.id.slice(0, 8)}
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
                Select a draft to edit.
              </p>
            ) : (
              <DraftEditor
                key={selected.id}
                draftId={selected.id}
                initialDisplayName={selected.displayName}
                initialThemeId={
                  typeof selected.themeId === "string" ? selected.themeId : null
                }
                initialTsxSource={selected.tsxSource}
                sentAt={selected.sentAt}
                themes={themes}
                onDeleted={() => setSelectedId(null)}
              />
            )}
          </div>
        </div>
      )}

      <CreateDraftDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  )
}

function DraftsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <EnvelopeIcon />
          </EmptyMedia>
          <EmptyTitle>No drafts yet</EmptyTitle>
          <EmptyDescription>
            Drafts let you compose and iterate on one-off emails before sending.
            Create one to get started.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon />
            New draft
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function CreateDraftDialog({
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
      const { id } = await adminApp.createEmailDraft({ displayName: name })
      toast.success(`Draft "${name}" created.`)
      reset()
      onOpenChange(false)
      onCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create draft.")
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
            <DialogTitle>New draft</DialogTitle>
            <DialogDescription>
              You can customize the TSX source and theme afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="draft-name">Display name</Label>
              <Input
                id="draft-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Q2 product update"
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
              {submitting ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DraftEditor({
  draftId,
  initialDisplayName,
  initialThemeId,
  initialTsxSource,
  sentAt,
  themes,
  onDeleted,
}: {
  draftId: string,
  initialDisplayName: string,
  initialThemeId: string | null,
  initialTsxSource: string,
  sentAt: Date | null,
  themes: Array<{ id: string, displayName: string }>,
  onDeleted: () => void,
}) {
  const adminApp = useAdminApp()
  const isLocked = sentAt != null

  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [tsxSource, setTsxSource] = useState(initialTsxSource)
  const [themeIdValue, setThemeIdValue] = useState<string>(
    initialThemeId ?? NO_THEME_VALUE
  )
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const currentThemeIdForPreview: string | undefined =
    themeIdValue === NO_THEME_VALUE ? undefined : themeIdValue

  const dirty =
    !isLocked && (
      displayName !== initialDisplayName ||
      tsxSource !== initialTsxSource ||
      (themeIdValue === NO_THEME_VALUE ? null : themeIdValue) !== initialThemeId
    )

  // Live preview reflects the current (unsaved) editor state.
  const previewHtml = adminApp.useEmailPreview({
    themeId: currentThemeIdForPreview,
    templateTsxSource: tsxSource,
  })

  const handleSave = async () => {
    if (isLocked) return
    setError(null)
    const themeIdToSend: string | false =
      themeIdValue === NO_THEME_VALUE ? false : themeIdValue
    try {
      await adminApp.updateEmailDraft(draftId, {
        displayName,
        themeId: themeIdToSend,
        tsxSource,
      })
      toast.success("Draft saved.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft.")
    }
  }

  const handleDelete = async () => {
    try {
      await adminApp.deleteEmailDraft(draftId)
      toast.success("Draft deleted.")
      setDeleteOpen(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft.")
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
            {draftId}
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

      {isLocked ? (
        <Alert>
          <CheckCircleIcon />
          <AlertTitle>This draft has been sent</AlertTitle>
          <AlertDescription>
            Sent on {sentAt.toLocaleString()}. Sent drafts are read-only.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="draft-displayname">Display name</Label>
        <Input
          id="draft-displayname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="draft-theme">Theme</Label>
        <Select
          value={themeIdValue}
          onValueChange={(v) => {
            if (typeof v === "string") setThemeIdValue(v)
          }}
          disabled={isLocked}
        >
          <SelectTrigger id="draft-theme" className="w-full">
            <SelectValue placeholder="No theme" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_THEME_VALUE}>No theme</SelectItem>
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
          <Label htmlFor="draft-source">TSX source</Label>
          <Textarea
            id="draft-source"
            value={tsxSource}
            onChange={(e) => setTsxSource(e.target.value)}
            spellCheck={false}
            readOnly={isLocked}
            className="min-h-[420px] font-mono text-[11px] leading-relaxed"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Live preview</Label>
          <iframe
            title="Email draft preview"
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

      <div className="flex items-center justify-end gap-2">
        <Button onClick={handleSave} disabled={!dirty || isLocked}>
          Save
        </Button>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The draft "{initialDisplayName}"
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
