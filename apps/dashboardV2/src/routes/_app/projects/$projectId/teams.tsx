import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import type { ServerTeam, ServerUser } from "@stackframe/tanstack-start"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { useAdminApp } from "@/lib/stack/admin-app"

export const Route = createFileRoute("/_app/projects/$projectId/teams")({
  component: TeamsPage,
})

function TeamsPage() {
  const adminApp = useAdminApp()
  const teams = adminApp.useTeams()

  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const filtered = useMemo(
    () =>
      teams.filter((t) =>
        t.displayName.toLowerCase().includes(query.toLowerCase())
      ),
    [teams, query]
  )

  // Tradeoff: we don't load member counts eagerly. Calling team.useUsers()
  // for every team in the list would fan out N hooks per render and produce
  // an N+1 fetch storm. Instead, we display "—" in the card and load the
  // members list on-demand when the detail sheet opens.

  const selectedTeam =
    selectedTeamId == null
      ? null
      : teams.find((t) => t.id === selectedTeamId) ?? null

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-5xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Teams
          </h1>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New team
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {teams.length === 0 ? (
          <TeamsEmpty onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search teams"
                  className="ps-8"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {filtered.length} of {teams.length}
              </p>
            </div>

            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No teams match "{query}".
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((team) => (
                  <li key={team.id}>
                    <TeamCard
                      team={team}
                      onSelect={() => setSelectedTeamId(team.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Sheet
        open={selectedTeam != null}
        onOpenChange={(o) => {
          if (!o) setSelectedTeamId(null)
        }}
      >
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          {selectedTeam ? (
            <TeamDetail
              team={selectedTeam}
              onClose={() => setSelectedTeamId(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TeamCard({
  team,
  onSelect,
}: {
  team: ServerTeam,
  onSelect: () => void,
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group block h-full w-full rounded-lg bg-card p-4 text-start ring-1 ring-foreground/10 transition-colors hover:bg-accent/40 hover:ring-foreground/20 hover:transition-none"
    >
      <div className="flex items-start gap-3">
        <TeamAvatar team={team} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-medium">
            {team.displayName}
          </p>
          <p className="text-xs text-muted-foreground">
            {/* "—" because eagerly counting is N+1; see comment in TeamsPage. */}
            — members
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-mono">{team.id.slice(0, 8)}</span>
        <span>
          Created{" "}
          {new Date(team.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
    </button>
  )
}

function TeamAvatar({
  team,
  size = "default",
}: {
  team: ServerTeam,
  size?: "default" | "sm" | "lg",
}) {
  const initials = team.displayName.slice(0, 2).toUpperCase()
  return (
    <Avatar size={size}>
      {team.profileImageUrl ? (
        <AvatarImage src={team.profileImageUrl} alt={team.displayName} />
      ) : null}
      <AvatarFallback className="bg-primary/10 font-heading text-primary">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}

function TeamsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersThreeIcon />
          </EmptyMedia>
          <EmptyTitle>No teams yet</EmptyTitle>
          <EmptyDescription>
            Teams group users together to share permissions, resources, and
            access. Create one to start organizing members.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon />
            New team
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const adminApp = useAdminApp()
  const [displayName, setDisplayName] = useState("")
  const [profileImageUrl, setProfileImageUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setDisplayName("")
    setProfileImageUrl("")
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!displayName.trim()) {
      setError("Display name is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await adminApp.createTeam({
        displayName: displayName.trim(),
        profileImageUrl: profileImageUrl.trim() || undefined,
      })
      toast.success(`Team "${displayName.trim()}" created.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create team."
      setError(message)
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
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>
              Create a team to group users. You can add members afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Display name</Label>
              <Input
                id="team-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Engineering"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-image">
                Profile image URL{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="team-image"
                type="url"
                value={profileImageUrl}
                onChange={(e) => setProfileImageUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
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
              {submitting ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TeamDetail({
  team,
  onClose,
}: {
  team: ServerTeam,
  onClose: () => void,
}) {
  const members = team.useUsers()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [memberToRemove, setMemberToRemove] = useState<ServerUser | null>(null)

  const handleRemoveMember = async () => {
    if (memberToRemove == null) return
    const target = memberToRemove
    try {
      await team.removeUser(target.id)
      toast.success(
        `Removed ${target.displayName ?? target.primaryEmail ?? target.id}.`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member.")
    } finally {
      setMemberToRemove(null)
    }
  }

  return (
    <>
      <SheetHeader className="border-b">
        <div className="flex items-start gap-3">
          <TeamAvatar team={team} size="lg" />
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-base">
              {team.displayName}
            </SheetTitle>
            <SheetDescription>
              <code className="font-mono text-[10px]">{team.id}</code>
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <section className="space-y-2">
          <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Metadata
          </h3>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-xs">
            <dt className="text-muted-foreground">Created</dt>
            <dd>
              {new Date(team.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </dd>
            <dt className="text-muted-foreground">Members</dt>
            <dd>{members.length.toLocaleString()}</dd>
          </dl>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Members ({members.length})
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddMemberOpen(true)}
            >
              <UserPlusIcon />
              Add
            </Button>
          </div>

          {members.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No members in this team.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md ring-1 ring-foreground/10">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Avatar size="sm">
                    {m.profileImageUrl ? (
                      <AvatarImage
                        src={m.profileImageUrl}
                        alt={m.displayName ?? m.primaryEmail ?? m.id}
                      />
                    ) : null}
                    <AvatarFallback>
                      {(m.displayName ?? m.primaryEmail ?? "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {m.displayName ?? "Unnamed user"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {m.primaryEmail ?? "No email"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove member"
                    onClick={() => setMemberToRemove(m)}
                  >
                    <UserMinusIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            Actions
          </h3>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => setRenameOpen(true)}>
              Rename team
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <TrashIcon />
              Delete team
            </Button>
          </div>
        </section>
      </div>

      <RenameTeamDialog
        team={team}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />

      <AddMemberDialog
        team={team}
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        existingMemberIds={new Set(members.map((m) => m.id))}
      />

      <DeleteTeamDialog
        team={team}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onClose}
      />

      <AlertDialog
        open={memberToRemove != null}
        onOpenChange={(o) => {
          if (!o) setMemberToRemove(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {memberToRemove
                ? `${memberToRemove.displayName ?? memberToRemove.primaryEmail ?? memberToRemove.id} will lose access to ${team.displayName}.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleRemoveMember}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RenameTeamDialog({
  team,
  open,
  onOpenChange,
}: {
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const [displayName, setDisplayName] = useState(team.displayName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next = displayName.trim()
    if (!next) {
      setError("Display name is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await team.update({ displayName: next })
      toast.success("Team renamed.")
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename team.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setDisplayName(team.displayName)
          setError(null)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename team</DialogTitle>
            <DialogDescription>
              Update the team's display name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rename-team-name">Display name</Label>
              <Input
                id="rename-team-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
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
              {submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddMemberDialog({
  team,
  open,
  onOpenChange,
  existingMemberIds,
}: {
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  existingMemberIds: Set<string>,
}) {
  const adminApp = useAdminApp()
  // useUsers() is already a list-fetched hook — fine to use for client-side
  // search. For very large user bases we'd switch to server-side query, but
  // the SDK's `query` option still requires a fetch each keystroke.
  const allUsers = adminApp.useUsers()
  const [search, setSearch] = useState("")
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [] as Array<ServerUser>
    return allUsers
      .filter((u) => !existingMemberIds.has(u.id))
      .filter((u) => {
        const email = u.primaryEmail?.toLowerCase() ?? ""
        const name = u.displayName?.toLowerCase() ?? ""
        return email.includes(q) || name.includes(q)
      })
      .slice(0, 10)
  }, [allUsers, existingMemberIds, search])

  const handleAdd = async (user: ServerUser) => {
    setSubmittingId(user.id)
    try {
      await team.addUser(user.id)
      toast.success(
        `Added ${user.displayName ?? user.primaryEmail ?? user.id} to ${team.displayName}.`
      )
      setSearch("")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member.")
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSearch("")
        }
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Search for an existing user by email or name.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="user@example.com"
              className="ps-8"
              autoFocus
            />
          </div>

          {search.trim() === "" ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Start typing to find users.
            </p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No matching users.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md ring-1 ring-foreground/10">
              {candidates.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Avatar size="sm">
                    {u.profileImageUrl ? (
                      <AvatarImage
                        src={u.profileImageUrl}
                        alt={u.displayName ?? u.primaryEmail ?? u.id}
                      />
                    ) : null}
                    <AvatarFallback>
                      {(u.displayName ?? u.primaryEmail ?? "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {u.displayName ?? "Unnamed user"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {u.primaryEmail ?? "No email"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={submittingId != null}
                    onClick={() => handleAdd(u)}
                  >
                    {submittingId === u.id ? "Adding…" : "Add"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeleteTeamDialog({
  team,
  open,
  onOpenChange,
  onDeleted,
}: {
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onDeleted: () => void,
}) {
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = confirm === team.displayName

  const handleDelete = async () => {
    if (!matches) {
      setError("Type the team's display name to confirm.")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await team.delete()
      toast.success(`Deleted "${team.displayName}".`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete team.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setConfirm("")
          setError(null)
        }
        onOpenChange(o)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this team?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. All members will lose access. To
            confirm, type the team name <strong>{team.displayName}</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-delete">Team name</Label>
          <Input
            id="confirm-delete"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={team.displayName}
            autoComplete="off"
          />
          {error != null ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || submitting}
            onClick={handleDelete}
          >
            {submitting ? "Deleting…" : "Delete team"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

