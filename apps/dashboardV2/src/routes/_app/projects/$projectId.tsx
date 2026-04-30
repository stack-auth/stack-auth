import { Link, Outlet, createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import type { ErrorComponentProps } from "@tanstack/react-router"

import { ProjectSidebar } from "@/components/console/project-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AdminAppProvider } from "@/lib/stack/admin-app"
import { Skeleton } from "@/components/ui/skeleton"
import { buttonVariants } from "@/components/ui/button"

export const Route = createFileRoute("/_app/projects/$projectId")({
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
      <AdminAppProvider projectId={projectId}>
        <SidebarProvider defaultOpen>
          <ProjectSidebar />
          <SidebarInset className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<ProjectContentSkeleton />}>
              <Outlet />
            </Suspense>
          </SidebarInset>
        </SidebarProvider>
      </AdminAppProvider>
    </Suspense>
  )
}

function ProjectShellSkeleton() {
  return (
    <div className="flex min-h-svh w-full">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r bg-sidebar p-3 md:flex">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="mt-2 h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="mt-4 h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <ProjectContentSkeleton />
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
