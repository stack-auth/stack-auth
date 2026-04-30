import * as React from "react"
import { useUser } from "@stackframe/tanstack-start"
import { useParams } from "@tanstack/react-router"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { StackAdminApp } from "@stackframe/tanstack-start"

/**
 * Context wiring for the per-project `StackAdminApp` instance.
 *
 * The admin app is derived from the currently signed-in user's owned projects
 * (the only projects they have admin access to). The `$projectId` route mounts
 * `<AdminAppProvider>` so descendants can call `useAdminApp()` without
 * re-deriving it.
 */

const AdminAppContext = React.createContext<StackAdminApp<false> | null>(null)

type AdminAppProviderProps = {
  projectId: string,
  children: React.ReactNode,
}

export function AdminAppProvider({ projectId, children }: AdminAppProviderProps) {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })
  const projects = user.useOwnedProjects()
  const project = projects.find((p) => p.id === projectId)
    ?? throwErr(`Project ${projectId} not found among the current user's owned projects.`)

  return (
    <AdminAppContext.Provider value={project.app}>
      {children}
    </AdminAppContext.Provider>
  )
}

export function useAdminApp(): StackAdminApp<false> {
  const ctx = React.useContext(AdminAppContext)
  return ctx ?? throwErr("useAdminApp() must be called inside an <AdminAppProvider>.")
}

export function useAdminAppIfExists(): StackAdminApp<false> | null {
  return React.useContext(AdminAppContext)
}

export function useProjectId(): string {
  const params = useParams({ from: "/_app/projects/$projectId" })
  return params.projectId
}
