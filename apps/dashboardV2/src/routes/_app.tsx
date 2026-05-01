import { Outlet, createFileRoute } from "@tanstack/react-router"
import { useUser } from "@stackframe/tanstack-start"
import { Suspense } from "react"
import type { ErrorComponentProps } from "@tanstack/react-router"

import { AppSidebar } from "@/components/console/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { stackApp } from "@/lib/stack/app"

export const Route = createFileRoute("/_app")({
  component: AppLayout,
  errorComponent: AppErrorBoundary,
})

function AppLayout() {
  // Redirects to sign-in when no user is present.
  useUser({ or: "redirect" })

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          "--app-sidebar-width": "3.25rem",
          "--sidebar-width-icon": "var(--app-sidebar-width)",
        } as React.CSSProperties
      }
    >
      <div className="flex min-h-svh w-full ps-(--app-sidebar-width)">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<AppSuspenseFallback />}>
            <Outlet />
          </Suspense>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

function AppSuspenseFallback() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-4 w-72" />
      <div className="mt-4 flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  )
}

function AppErrorBoundary({ error, reset }: ErrorComponentProps) {
  console.error(error)
  const message = error instanceof Error ? error.message : String(error)
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <AlertTitle>We couldn&apos;t load your account.</AlertTitle>
          <AlertDescription>
            <p>{message}</p>
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={() => reset()} variant="outline">
            Try again
          </Button>
          <Button onClick={() => window.location.reload()} variant="outline">
            Reload
          </Button>
          <Button
            onClick={() => {
              void stackApp.redirectToSignOut()
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </main>
  )
}
