import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"

import type { ServerTeam, ServerUser } from "@stackframe/tanstack-start"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ProjectDetailSheet } from "@/components/console/project-detail-sheet"
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
import {
  useProjectUsersForTeamAddQuery,
  useStackAuthQueryInvalidation,
  useTeamMembersQuery,
} from "@/lib/stack/react-query"

export function TeamDetailSheet({
  team,
  open,
  onOpenChange,
  onViewMember,
}: {
  team: ServerTeam | null
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onViewMember: (userId: string) => void
}) {
  return (
    <ProjectDetailSheet
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-0"
    >
      {team == null ? null : (
        <TeamDetail
          key={team.id}
          team={team}
          onClose={() => onOpenChange(false)}
          onViewMember={onViewMember}
        />
      )}
    </ProjectDetailSheet>
  )
}

function TeamAvatar({
  team,
  size = "default",
}: {
  team: ServerTeam
  size?: "default" | "sm" | "lg"
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

function TeamDetail({
  team,
  onClose,
  onViewMember,
}: {
  team: ServerTeam
  onClose: () => void
  onViewMember: (userId: string) => void
}) {
  const adminApp = useAdminApp()
  const { invalidateTeamMembers, invalidateTeams } =
    useStackAuthQueryInvalidation()
  const membersQuery = useTeamMembersQuery(team, adminApp)
  const members = membersQuery.data
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [memberToRemove, setMemberToRemove] = useState<ServerUser | null>(null)
  const visibleMembers = members ?? []

  const handleRemoveMember = async () => {
    if (memberToRemove == null) return
    const target = memberToRemove
    try {
      await team.removeUser(target.id)
      await invalidateTeamMembers(adminApp.projectId, team.id)
      toast.success(
        `Removed ${target.displayName ?? target.primaryEmail ?? target.id}.`
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove member."
      )
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
            <dd>
              {members == null ? "Loading" : members.length.toLocaleString()}
            </dd>
          </dl>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              Members ({members == null ? "..." : members.length})
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

          {members == null ? (
            <MembersInitialSkeleton />
          ) : members.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No members in this team.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md ring-1 ring-foreground/10">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
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
                  <button
                    type="button"
                    onClick={() => onViewMember(m.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <p className="truncate text-xs font-medium">
                      {m.displayName ?? "Unnamed user"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {m.primaryEmail ?? "No email"}
                    </p>
                  </button>
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
        onRenamed={async () => {
          await invalidateTeams(adminApp.projectId)
        }}
      />

      {addMemberOpen ? (
        <AddMemberDialog
          team={team}
          open={addMemberOpen}
          onOpenChange={setAddMemberOpen}
          existingMemberIds={new Set(visibleMembers.map((m) => m.id))}
        />
      ) : null}

      <DeleteTeamDialog
        team={team}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onClose}
        onTeamsChanged={async () => {
          await invalidateTeams(adminApp.projectId)
        }}
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

function MembersInitialSkeleton() {
  return (
    <ul className="divide-y divide-border rounded-md ring-1 ring-foreground/10">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="size-8 rounded-md" />
        </li>
      ))}
    </ul>
  )
}

function RenameTeamDialog({
  team,
  open,
  onOpenChange,
  onRenamed,
}: {
  team: ServerTeam
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onRenamed: () => Promise<void>
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
      await onRenamed()
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
  team: ServerTeam
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  existingMemberIds: Set<string>
}) {
  const adminApp = useAdminApp()
  const { invalidateTeamMembers } = useStackAuthQueryInvalidation()
  const usersQuery = useProjectUsersForTeamAddQuery(adminApp)
  const allUsers = usersQuery.data
  const [search, setSearch] = useState("")
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (allUsers == null) return [] as Array<ServerUser>
    if (!q) return [] as Array<ServerUser>
    return allUsers
      .filter((u) => !existingMemberIds.has(u.id))
      .filter((u) =>
        [u.displayName, u.primaryEmail, u.id]
          .filter((v): v is string => v != null)
          .some((v) => v.toLowerCase().includes(q))
      )
      .slice(0, 8)
  }, [allUsers, existingMemberIds, search])

  const handleAdd = async (user: ServerUser) => {
    setSubmittingId(user.id)
    try {
      await team.addUser(user.id)
      await invalidateTeamMembers(adminApp.projectId, team.id)
      toast.success(
        `Added ${user.displayName ?? user.primaryEmail ?? user.id} to ${team.displayName}.`
      )
      onOpenChange(false)
      setSearch("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member.")
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Search for a user to add to {team.displayName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="member-search">User</Label>
            <Input
              id="member-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or ID"
              autoFocus
            />
          </div>

          {allUsers == null ? (
            <AddMemberUsersSkeleton />
          ) : search.trim() === "" ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Start typing to find users.
            </p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No matching users available.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md ring-1 ring-foreground/10">
              {candidates.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
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
                      {u.primaryEmail ?? u.id}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={submittingId != null}
                    onClick={() => void handleAdd(u)}
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

function AddMemberUsersSkeleton() {
  return (
    <ul className="divide-y divide-border rounded-md ring-1 ring-foreground/10">
      {Array.from({ length: 3 }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="size-8 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-8 w-12 rounded-md" />
        </li>
      ))}
    </ul>
  )
}

function DeleteTeamDialog({
  team,
  open,
  onOpenChange,
  onDeleted,
  onTeamsChanged,
}: {
  team: ServerTeam
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
  onDeleted: () => void
  onTeamsChanged: () => Promise<void>
}) {
  const [confirm, setConfirm] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canDelete = confirm === team.displayName

  const handleDelete = async () => {
    if (!canDelete) return
    setSubmitting(true)
    setError(null)
    try {
      await team.delete()
      await onTeamsChanged()
      toast.success(`Deleted "${team.displayName}".`)
      onOpenChange(false)
      onDeleted()
      setConfirm("")
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
          <AlertDialogTitle>Delete team?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes {team.displayName}. Type the team name to
            confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-team-confirm">Team name</Label>
          <Input
            id="delete-team-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={team.displayName}
          />
          {error != null ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!canDelete || submitting}
            onClick={handleDelete}
          >
            {submitting ? "Deleting…" : "Delete team"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
