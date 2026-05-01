import * as React from "react"
import { useParams } from "@tanstack/react-router"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { StackAdminApp } from "@stackframe/tanstack-start"

export const AdminAppContext = React.createContext<StackAdminApp<false> | null>(null)

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
