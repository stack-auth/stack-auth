import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"
import { Suspense } from "react"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { ErrorComponentProps } from "@tanstack/react-router"

import { ProjectSidebar } from "@/components/console/project-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AdminAppProvider } from "@/lib/stack/admin-app"
import { Skeleton } from "@/components/ui/skeleton"
import { buttonVariants } from "@/components/ui/button"
import { useAdminApp } from "@/lib/stack/admin-app-context"
import { useProjectUserQuery, useTeamsQuery } from "@/lib/stack/react-query"
import { UserDetailSheet } from "@/components/projects/users/user-detail-sheet"
import { TeamDetailSheet } from "@/components/projects/teams/team-detail-sheet"
import { getProjectEntityDrawerHref } from "@/lib/console/project-entity-drawer-url"

type ProjectSearch = {
  userId?: string
  teamId?: string
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>): ProjectSearch => ({
    userId: typeof search.userId === "string" ? search.userId : undefined,
    teamId: typeof search.teamId === "string" ? search.teamId : undefined,
  }),
  component: ProjectLayout,
  errorComponent: ProjectErrorBoundary,
})

/**
 * Dual-sidebar architecture:
 *
 * The parent `_app` layout already mounts a `<SidebarProvider>` to drive the
 * fixed icon-rail (`AppSidebar`, `collapsible="none"`, so its provider state is
 * effectively unused). We render this project-scoped sidebar *inside* the
 * parent's `<SidebarInset>` and wrap it in a SECOND, NESTED `<SidebarProvider>`.
 *
 * Because `useSidebar()` reads from the nearest React context, the project
 * sidebar's open/collapsed state is fully independent. The shadcn
 * `SidebarProvider` already persists `open` to the `sidebar_state` cookie, so
 * the collapsed state survives reloads. Both providers write to the same
 * cookie name; that's acceptable here because the outer provider's open state
 * is not user-toggleable (the rail is `collapsible="none"`), so the cookie
 * effectively reflects the project sidebar.
 */
function ProjectLayout() {
  const { projectId } = Route.useParams()

  return (
    <Suspense fallback={<ProjectShellSkeleton />}>
      <AdminAppProvider projectId={projectId} fallback={<ProjectShellSkeleton />}>
        <SidebarProvider defaultOpen>
          <ProjectSidebar />
          <SidebarInset className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<ProjectContentSkeleton />}>
              <Outlet />
              <ProjectEntityDetailDrawers />
            </Suspense>
          </SidebarInset>
        </SidebarProvider>
      </AdminAppProvider>
    </Suspense>
  )
}

function ProjectEntityDetailDrawers() {
  const adminApp = useAdminApp()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const selectedUserId = search.userId ?? null
  const selectedTeamId = search.teamId ?? null
  const selectedUserQuery = useProjectUserQuery(adminApp, selectedUserId)
  const teamsQuery = useTeamsQuery(adminApp)
  const selectedTeam =
    selectedTeamId == null
      ? null
      : (teamsQuery.data?.find((team) => team.id === selectedTeamId) ?? null)

  const setSelectedUserId = (userId: string | null) => {
    runAsynchronouslyWithAlert(
      navigate({
        href: getProjectEntityDrawerHref(window.location.href, { userId }),
        resetScroll: false,
      })
    )
  }
  const setSelectedTeamId = (teamId: string | null) => {
    runAsynchronouslyWithAlert(
      navigate({
        href: getProjectEntityDrawerHref(window.location.href, { teamId }),
        resetScroll: false,
      })
    )
  }

  return (
    <>
      <UserDetailSheet
        user={selectedUserQuery.data ?? null}
        open={selectedUserId != null && selectedTeamId == null}
        onOpenChange={(open) => {
          if (!open) setSelectedUserId(null)
        }}
        onViewTeam={setSelectedTeamId}
      />
      <TeamDetailSheet
        team={selectedTeam}
        open={selectedTeamId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedTeamId(null)
        }}
        onViewMember={setSelectedUserId}
      />
    </>
  )
}

function ProjectShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full">
      <div className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-e-lg border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex flex-col gap-2 p-2">
          <div className="flex items-center gap-2 px-1.5 py-1">
            <Skeleton className="size-7 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="size-8 shrink-0 rounded-md" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SidebarSkeletonGroup labelWidth="3.5rem" itemWidths={["5rem", "6rem"]} />
          <SidebarSkeletonGroup labelWidth="2.25rem" itemWidths={["3.5rem", "3.5rem", "6rem"]} />
          <SidebarSkeletonGroup labelWidth="5rem" itemWidths={["4rem", "5rem"]} />
        </div>

        <div className="flex flex-col gap-2 p-2">
          <div className="flex items-center justify-between px-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <ProjectContentSkeleton />
      </div>
    </div>
  )
}

function SidebarSkeletonGroup({
  labelWidth,
  itemWidths,
}: {
  labelWidth: string,
  itemWidths: ReadonlyArray<string>,
}) {
  return (
    <div className="relative flex w-full min-w-0 flex-col px-2 py-1">
      <div className="flex h-8 shrink-0 items-center rounded-md px-2">
        <Skeleton className="h-3" style={{ width: labelWidth }} />
      </div>
      <div className="flex w-full min-w-0 flex-col gap-px">
        {itemWidths.map((itemWidth, index) => (
          <div
            key={`${itemWidth}-${index}`}
            className="flex h-8 w-full items-center gap-2 rounded-[calc(var(--radius-sm)+2px)] p-2"
          >
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className="h-3.5" style={{ width: itemWidth }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectContentSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  )
}

function ProjectErrorBoundary({ error }: ErrorComponentProps) {
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Project unavailable
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Project failed to load.
        </h1>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t reach this project. It may have been deleted or your
          access may have changed.
        </p>
        <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 text-left text-[11px] text-muted-foreground">
          {message}
        </pre>
        <Link to="/projects" className={buttonVariants({ variant: "default" })}>
          <ArrowLeftIcon weight="bold" />
          Back to projects
        </Link>
      </div>
    </main>
  )
}
