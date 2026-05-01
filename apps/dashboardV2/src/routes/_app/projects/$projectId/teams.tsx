import { useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { PlusIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"

import type { ServerTeam } from "@stackframe/tanstack-start"
import type { VirtualDataGridColumn } from "@/components/ui/virtual-data-grid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
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
  PROJECT_PAGE_HEADER_STICKY_TOP_CLASS,
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { VirtualDataGrid } from "@/components/ui/virtual-data-grid"
import { formatRecentDashboardDate } from "@/lib/dates"
import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useStackAuthQueryInvalidation,
  useTeamsQuery,
} from "@/lib/stack/react-query"

type TeamsSearch = {
  teamId?: string
  userId?: string
}

export const Route = createFileRoute("/_app/projects/$projectId/teams")({
  validateSearch: (search: Record<string, unknown>): TeamsSearch => ({
    teamId: typeof search.teamId === "string" ? search.teamId : undefined,
    userId: typeof search.userId === "string" ? search.userId : undefined,
  }),
  component: TeamsPage,
})

function TeamsPage() {
  const adminApp = useAdminApp()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const teamsQuery = useTeamsQuery(adminApp)
  const teams = teamsQuery.data
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const selectedTeamId = search.teamId ?? null
  const teamsTableColumns = useTeamsTableColumns()

  const visibleTeams = teams ?? []

  const filtered = useMemo(
    () =>
      visibleTeams.filter((t) =>
        t.displayName.toLowerCase().includes(query.toLowerCase())
      ),
    [visibleTeams, query]
  )

  const setSelectedTeamId = (teamId: string | null) => {
    runAsynchronouslyWithAlert(
      navigate({
        to: "/projects/$projectId/teams",
        params: { projectId: adminApp.projectId },
        search: (previous) => ({
          ...previous,
          teamId: teamId ?? undefined,
          userId: undefined,
        }),
        resetScroll: false,
      })
    )
  }

  return (
    <ProjectPage>
      <ProjectPageHeader
        title="Teams"
        actions={
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            New team
          </Button>
        }
      />

      <ProjectPageMain className="py-4">
        {teams == null ? (
          <TeamsInitialSkeleton columns={teamsTableColumns} />
        ) : teams.length === 0 ? (
          <TeamsEmpty onCreate={() => setCreateOpen(true)} />
        ) : (
          <VirtualDataGrid
            columns={teamsTableColumns}
            items={filtered}
            getItemKey={(team) => team.id}
            isLoading={false}
            hasNextPage={false}
            isFetchingNextPage={false}
            fetchNextPage={() => {}}
            searchValue={query}
            onSearchValueChange={setQuery}
            searchPlaceholder="Search teams"
            headerAccessory={
              <p className="whitespace-nowrap text-xs text-muted-foreground">
                {filtered.length} of {teams.length}
              </p>
            }
            isSearching={query.trim().length > 0}
            emptyMessage={`No teams match "${query}".`}
            selectedItemKey={selectedTeamId}
            onSelectItemKey={setSelectedTeamId}
            keyboardNavigationDisabled={createOpen}
            frameClassName="rounded-lg border [clip-path:inset(0_round_var(--radius-lg))]"
            stickyTopClassName={PROJECT_PAGE_HEADER_STICKY_TOP_CLASS}
          />
        )}
      </ProjectPageMain>

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </ProjectPage>
  )
}

function TeamsInitialSkeleton({
  columns,
}: {
  columns: Array<VirtualDataGridColumn<ServerTeam, string>>
}) {
  return (
    <VirtualDataGrid
      columns={columns}
      items={[]}
      getItemKey={(team) => team.id}
      isLoading
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={() => {}}
      searchValue=""
      onSearchValueChange={() => {}}
      searchPlaceholder="Search teams"
      isSearching={false}
      emptyMessage=""
      frameClassName="rounded-lg border [clip-path:inset(0_round_var(--radius-lg))]"
      stickyTopClassName={PROJECT_PAGE_HEADER_STICKY_TOP_CLASS}
    />
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

function useTeamsTableColumns() {
  return useMemo<Array<VirtualDataGridColumn<ServerTeam, string>>>(
    () => [
      {
        id: "team",
        label: "Team",
        width: "minmax(0,1.5fr)",
        renderCell: (team) => (
          <div className="flex min-w-0 items-center gap-3">
            <TeamAvatar team={team} />
            <div className="min-w-0">
              <p className="truncate font-heading text-sm font-medium">
                {team.displayName}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {team.id}
              </p>
            </div>
          </div>
        ),
        renderSkeleton: () => (
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ),
      },
      {
        id: "members",
        label: "Members",
        width: "minmax(7rem,0.6fr)",
        renderCell: () => (
          <span className="text-muted-foreground">
            {/* "—" because eagerly counting is N+1; detail loads members on-demand. */}
            — members
          </span>
        ),
        renderSkeleton: () => <Skeleton className="h-4 w-20" />,
      },
      {
        id: "created",
        label: "Created",
        width: "minmax(8rem,0.6fr)",
        renderCell: (team) => (
          <span className="text-muted-foreground">
            {formatRecentDashboardDate(team.createdAt)}
          </span>
        ),
        renderSkeleton: () => <Skeleton className="h-4 w-24" />,
      },
    ],
    []
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
  open: boolean
  onOpenChange: (nextOpen: boolean) => void
}) {
  const adminApp = useAdminApp()
  const { invalidateTeams } = useStackAuthQueryInvalidation()
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
      await invalidateTeams(adminApp.projectId)
      toast.success(`Team "${displayName.trim()}" created.`)
      reset()
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create team."
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
