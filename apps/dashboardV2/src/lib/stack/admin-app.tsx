import * as React from "react"
import { useUser } from "@stackframe/tanstack-start"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { AdminProject, StackAdminApp } from "@stackframe/tanstack-start"

import { AdminAppContext } from "@/lib/stack/admin-app-context"
import {
  useAdminProjectConfig,
  useAdminProjectQuery,
  useOwnedProjectsQuery,
  useProjectQueryWarmup,
} from "@/lib/stack/react-query"

export { useAdminApp, useAdminAppIfExists, useProjectId } from "@/lib/stack/admin-app-context"

/**
 * Context wiring for the per-project `StackAdminApp` instance.
 *
 * The admin app is derived from the currently signed-in user's owned projects
 * (the only projects they have admin access to). The `$projectId` route mounts
 * `<AdminAppProvider>` so descendants can call `useAdminApp()` without
 * re-deriving it.
 */

type AdminAppProviderProps = {
  projectId: string,
  children: React.ReactNode,
  fallback?: React.ReactNode,
}

export function AdminAppProvider({ projectId, children, fallback = null }: AdminAppProviderProps) {
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" })
  const { data: projects } = useOwnedProjectsQuery(user)
  if (projects == null) {
    return fallback
  }
  const project = projects.find((p) => p.id === projectId)
    ?? throwErr(`Project ${projectId} not found among the current user's owned projects.`)

  return (
    <AdminAppContext.Provider value={project.app}>
      <AdminProjectPrefetch fallback={fallback}>{children}</AdminProjectPrefetch>
    </AdminAppContext.Provider>
  )
}

function AdminProjectPrefetch({
  children,
  fallback,
}: {
  children: React.ReactNode,
  fallback: React.ReactNode,
}) {
  const adminApp = React.useContext(AdminAppContext)
    ?? throwErr("AdminProjectPrefetch must be rendered inside an <AdminAppContext.Provider>.")
  const projectQuery = useAdminProjectQuery(adminApp)
  const project = projectQuery.data
  if (projectQuery.error != null) {
    throw projectQuery.error
  }
  if (project == null) {
    return fallback
  }

  return (
    <AdminProjectConfigPrefetch adminApp={adminApp} project={project} fallback={fallback}>
      {children}
    </AdminProjectConfigPrefetch>
  )
}

function AdminProjectConfigPrefetch({
  adminApp,
  project,
  fallback,
  children,
}: {
  adminApp: StackAdminApp<false>,
  project: AdminProject,
  fallback: React.ReactNode,
  children: React.ReactNode,
}) {
  const configQuery = useAdminProjectConfig(project)
  if (configQuery.error != null) {
    throw configQuery.error
  }
  if (configQuery.data == null) {
    return fallback
  }

  return (
    <ProjectQueryWarmup adminApp={adminApp} project={project}>
      {children}
    </ProjectQueryWarmup>
  )
}

function ProjectQueryWarmup({
  adminApp,
  project,
  children,
}: {
  adminApp: StackAdminApp<false>,
  project: AdminProject,
  children: React.ReactNode,
}) {
  useProjectQueryWarmup(adminApp, project)
  return children
}
