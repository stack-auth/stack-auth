import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"
import { useUser } from "@stackframe/tanstack-start"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import {
  MetricsResponseBodySchema,
  MetricsUserCountsSchema,
} from "@stackframe/stack-shared/dist/interface/admin-metrics"
import type {
  MetricsResponse,
  MetricsUserCounts,
} from "@stackframe/stack-shared/dist/interface/admin-metrics"
import type {
  AdminProject,
  CurrentInternalUser,
  ServerTeam,
  ServerUser,
  StackAdminApp,
} from "@stackframe/tanstack-start"
import type { QueryClient, QueryKey } from "@tanstack/react-query"

import { useAdminApp } from "@/lib/stack/admin-app-context"

type CurrentInternalUserProject = Awaited<
  ReturnType<CurrentInternalUser["listOwnedProjects"]>
>[number]
type CurrentInternalUserTeam = Awaited<
  ReturnType<CurrentInternalUser["listTeams"]>
>[number]
type EmailPreviewOptions = Parameters<
  StackAdminApp<false>["getEmailPreview"]
>[0]
type EmailPreviewWithMarkersOptions = Parameters<
  StackAdminApp<false>["getEmailPreviewWithEditableMarkers"]
>[0]

const stackAppInternalsSymbol = Symbol.for(
  "StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals"
)

type StackAppInternals = {
  sendRequest: (
    path: string,
    requestOptions: RequestInit,
    requestType?: "client" | "server" | "admin"
  ) => Promise<Response>
}

function getStackAppInternals(app: object): StackAppInternals {
  const internals = Reflect.get(app, stackAppInternalsSymbol)
  if (
    typeof internals !== "object" ||
    internals == null ||
    !("sendRequest" in internals)
  ) {
    throw new Error("Stack app internals are unavailable: missing sendRequest")
  }
  const sendRequest = internals.sendRequest
  if (typeof sendRequest !== "function") {
    throw new Error(
      "Stack app internals are unavailable: sendRequest is not callable"
    )
  }
  return { sendRequest }
}

async function readJsonResponse(
  response: Response,
  errorPrefix: string
): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `${errorPrefix}: ${response.status} ${response.statusText} - ${text}`
    )
  }
  return await response.json()
}

export const stackAuthQueryKeys = {
  all: ["stack-auth"] as const,
  currentUser: (userId: string) =>
    [...stackAuthQueryKeys.all, "current-user", userId] as const,
  ownedProjects: (userId: string) =>
    [...stackAuthQueryKeys.currentUser(userId), "owned-projects"] as const,
  currentUserTeams: (userId: string) =>
    [...stackAuthQueryKeys.currentUser(userId), "teams"] as const,
  project: (projectId: string) =>
    [...stackAuthQueryKeys.all, "project", projectId] as const,
  projectConfig: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "config"] as const,
  internalApiKeys: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "internal-api-keys"] as const,
  metrics: (projectId: string, includeAnonymous: boolean) =>
    [
      ...stackAuthQueryKeys.project(projectId),
      "metrics",
      includeAnonymous,
    ] as const,
  metricsUserCounts: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "metrics-user-counts"] as const,
  teams: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "teams"] as const,
  teamMembers: (projectId: string, teamId: string) =>
    [...stackAuthQueryKeys.teams(projectId), teamId, "members"] as const,
  projectUser: (projectId: string, userId: string) =>
    [...stackAuthQueryKeys.project(projectId), "user", userId] as const,
  projectUsersForTeamAdd: (projectId: string) =>
    [
      ...stackAuthQueryKeys.project(projectId),
      "team-add-member-users",
    ] as const,
  permissionDefinitions: (projectId: string, kind: "team" | "project") =>
    [
      ...stackAuthQueryKeys.project(projectId),
      "permission-definitions",
      kind,
    ] as const,
  svixToken: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "svix-token"] as const,
  stripeAccountInfo: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "stripe-account-info"] as const,
  emailThemes: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "email-themes"] as const,
  emailTheme: (projectId: string, themeId: string) =>
    [...stackAuthQueryKeys.emailThemes(projectId), themeId] as const,
  emailTemplates: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "email-templates"] as const,
  emailDrafts: (projectId: string) =>
    [...stackAuthQueryKeys.project(projectId), "email-drafts"] as const,
  emailPreview: (projectId: string, options: EmailPreviewOptions) =>
    [
      ...stackAuthQueryKeys.project(projectId),
      "email-preview",
      options,
    ] as const,
  emailPreviewWithMarkers: (
    projectId: string,
    options: EmailPreviewWithMarkersOptions
  ) =>
    [
      ...stackAuthQueryKeys.project(projectId),
      "email-preview-with-markers",
      options,
    ] as const,
}

function useInternalUser(): CurrentInternalUser {
  return useUser({ or: "redirect", projectIdMustMatch: "internal" })
}

export function useOwnedProjectsQuery(
  user: CurrentInternalUser = useInternalUser()
) {
  return useQuery<Array<CurrentInternalUserProject>>({
    queryKey: stackAuthQueryKeys.ownedProjects(user.id),
    queryFn: async () => await user.listOwnedProjects(),
    placeholderData: (previous) => previous,
  })
}

export function useCurrentUserTeamsQuery(
  user: CurrentInternalUser = useInternalUser()
) {
  return useQuery<Array<CurrentInternalUserTeam>>({
    queryKey: stackAuthQueryKeys.currentUserTeams(user.id),
    queryFn: async () => await user.listTeams(),
    placeholderData: (previous) => previous,
  })
}

export function useAdminProjectQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.project(adminApp.projectId),
    queryFn: async () => await adminApp.getProject(),
    placeholderData: (previous) => previous,
  })
}

export function useAdminProject(
  adminApp: StackAdminApp<false> = useAdminApp()
): AdminProject {
  return (
    useAdminProjectQuery(adminApp).data ??
    throwErr(`Project ${adminApp.projectId} has not loaded yet.`)
  )
}

export function useAdminProjectConfig(
  project: AdminProject = useAdminProject()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.projectConfig(project.id),
    queryFn: async () => await project.getConfig(),
    placeholderData: (previous) => previous,
  })
}

export function useLoadedAdminProjectConfig(
  project: AdminProject = useAdminProject()
) {
  return (
    useAdminProjectConfig(project).data ??
    throwErr(`Config for project ${project.id} has not loaded yet.`)
  )
}

export function useInternalApiKeysQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.internalApiKeys(adminApp.projectId),
    queryFn: async () => await adminApp.listInternalApiKeys(),
    placeholderData: (previous) => previous,
  })
}

export function useTeamsQuery(adminApp: StackAdminApp<false> = useAdminApp()) {
  return useQuery<Array<ServerTeam>>({
    queryKey: stackAuthQueryKeys.teams(adminApp.projectId),
    queryFn: async () => await adminApp.listTeams(),
    placeholderData: (previous) => previous,
  })
}

export function useTeamMembersQuery(
  team: ServerTeam,
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery<Array<ServerUser>>({
    queryKey: stackAuthQueryKeys.teamMembers(adminApp.projectId, team.id),
    queryFn: async () => await team.listUsers(),
    placeholderData: (previous) => previous,
  })
}

export function useProjectUsersForTeamAddQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery<Array<ServerUser>>({
    queryKey: stackAuthQueryKeys.projectUsersForTeamAdd(adminApp.projectId),
    queryFn: async () => await adminApp.listUsers({ includeRestricted: true }),
    placeholderData: (previous) => previous,
  })
}

export function useProjectUserQuery(
  adminApp: StackAdminApp<false>,
  userId: string | null
) {
  return useQuery<ServerUser | null>({
    queryKey:
      userId == null
        ? [...stackAuthQueryKeys.project(adminApp.projectId), "user", null]
        : stackAuthQueryKeys.projectUser(adminApp.projectId, userId),
    queryFn: async () => {
      if (userId == null) {
        throw new Error("Cannot load a project user without a user id.")
      }
      return await adminApp.getUser(userId)
    },
    enabled: userId != null,
    placeholderData: (previous) => previous,
  })
}

export function usePermissionDefinitionsQuery(
  kind: "team" | "project",
  list: () => Promise<
    Array<{
      id: string
      description?: string
      containedPermissionIds: Array<string>
    }>
  >,
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.permissionDefinitions(
      adminApp.projectId,
      kind
    ),
    queryFn: list,
    placeholderData: (previous) => previous,
  })
}

export function useTeamPermissionDefinitionsQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return usePermissionDefinitionsQuery(
    "team",
    async () => await adminApp.listTeamPermissionDefinitions(),
    adminApp
  )
}

export function useProjectPermissionDefinitionsQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return usePermissionDefinitionsQuery(
    "project",
    async () => await adminApp.listProjectPermissionDefinitions(),
    adminApp
  )
}

export function useMetricsQuery(
  adminApp: StackAdminApp<false> = useAdminApp(),
  includeAnonymous: boolean = false
) {
  return useQuery<MetricsResponse>({
    queryKey: stackAuthQueryKeys.metrics(adminApp.projectId, includeAnonymous),
    queryFn: async () => {
      const path = includeAnonymous
        ? "/internal/metrics?include_anonymous=true"
        : "/internal/metrics"
      const response = await getStackAppInternals(adminApp).sendRequest(
        path,
        {},
        "admin"
      )
      return await MetricsResponseBodySchema.validate(
        await readJsonResponse(response, "Failed to load metrics")
      )
    },
    placeholderData: (previous) => previous,
  })
}

export function useMetricsUserCountsQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery<MetricsUserCounts>({
    queryKey: stackAuthQueryKeys.metricsUserCounts(adminApp.projectId),
    queryFn: async () => {
      const response = await getStackAppInternals(adminApp).sendRequest(
        "/internal/metrics/user-counts",
        {},
        "admin"
      )
      return await MetricsUserCountsSchema.validate(
        await readJsonResponse(response, "Failed to load metric user counts")
      )
    },
    placeholderData: (previous) => previous,
  })
}

export function useSvixTokenQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.svixToken(adminApp.projectId),
    queryFn: async () => {
      const body = await readJsonResponse(
        await getStackAppInternals(adminApp).sendRequest(
          "/webhooks/svix-token",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
          "admin"
        ),
        "Failed to load Svix token"
      )
      if (
        body == null ||
        typeof body !== "object" ||
        !("token" in body) ||
        typeof body.token !== "string"
      ) {
        throw new Error("Unexpected Svix token response shape")
      }
      return {
        token: body.token,
        url:
          "url" in body && typeof body.url === "string" ? body.url : undefined,
      }
    },
    placeholderData: (previous) => previous,
  })
}

export function useStripeAccountInfoQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.stripeAccountInfo(adminApp.projectId),
    queryFn: async () => await adminApp.getStripeAccountInfo(),
    placeholderData: (previous) => previous,
  })
}

export function useEmailThemesQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.emailThemes(adminApp.projectId),
    queryFn: async () => await adminApp.listEmailThemes(),
    placeholderData: (previous) => previous,
  })
}

export function useEmailTemplatesQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.emailTemplates(adminApp.projectId),
    queryFn: async () => await adminApp.listEmailTemplates(),
    placeholderData: (previous) => previous,
  })
}

export function useEmailDraftsQuery(
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.emailDrafts(adminApp.projectId),
    queryFn: async () => await adminApp.listEmailDrafts(),
    placeholderData: (previous) => previous,
  })
}

export function useEmailThemeQuery(
  themeId: string,
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.emailTheme(adminApp.projectId, themeId),
    queryFn: async () => {
      const body = await readJsonResponse(
        await getStackAppInternals(adminApp).sendRequest(
          `/internal/email-themes/${encodeURIComponent(themeId)}`,
          { method: "GET" },
          "admin"
        ),
        "Failed to load email theme"
      )
      if (
        body == null ||
        typeof body !== "object" ||
        !("display_name" in body) ||
        typeof body.display_name !== "string" ||
        !("tsx_source" in body) ||
        typeof body.tsx_source !== "string"
      ) {
        throw new Error("Unexpected email theme response shape")
      }
      return {
        displayName: body.display_name,
        tsxSource: body.tsx_source,
      }
    },
    placeholderData: (previous) => previous,
  })
}

export function useEmailPreviewQuery(
  options: EmailPreviewOptions,
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.emailPreview(adminApp.projectId, options),
    queryFn: async () => await adminApp.getEmailPreview(options),
    placeholderData: (previous) => previous,
  })
}

export function useEmailPreviewWithMarkersQuery(
  options: EmailPreviewWithMarkersOptions,
  adminApp: StackAdminApp<false> = useAdminApp()
) {
  return useQuery({
    queryKey: stackAuthQueryKeys.emailPreviewWithMarkers(
      adminApp.projectId,
      options
    ),
    queryFn: async () =>
      await adminApp.getEmailPreviewWithEditableMarkers(options),
    placeholderData: (previous) => previous,
  })
}

export function useProjectQueryWarmup(
  adminApp: StackAdminApp<false>,
  project: AdminProject
) {
  const queryClient = useQueryClient()

  useEffect(() => {
    runAsynchronouslyWithAlert(
      Promise.all([
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.projectConfig(project.id),
          queryFn: async () => await project.getConfig(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.teams(adminApp.projectId),
          queryFn: async () => await adminApp.listTeams(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.permissionDefinitions(
            adminApp.projectId,
            "team"
          ),
          queryFn: async () => await adminApp.listTeamPermissionDefinitions(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.permissionDefinitions(
            adminApp.projectId,
            "project"
          ),
          queryFn: async () =>
            await adminApp.listProjectPermissionDefinitions(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.internalApiKeys(adminApp.projectId),
          queryFn: async () => await adminApp.listInternalApiKeys(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.emailThemes(adminApp.projectId),
          queryFn: async () => await adminApp.listEmailThemes(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.emailTemplates(adminApp.projectId),
          queryFn: async () => await adminApp.listEmailTemplates(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.emailDrafts(adminApp.projectId),
          queryFn: async () => await adminApp.listEmailDrafts(),
        }),
        queryClient.prefetchQuery({
          queryKey: stackAuthQueryKeys.stripeAccountInfo(adminApp.projectId),
          queryFn: async () => await adminApp.getStripeAccountInfo(),
        }),
      ])
    )
  }, [adminApp, project, queryClient])
}

export async function invalidateStackAuthQueries(
  queryClient: QueryClient,
  keys: ReadonlyArray<QueryKey>
) {
  await Promise.all(
    keys.map(async (queryKey) => {
      await queryClient.invalidateQueries({ queryKey })
    })
  )
}

export function useStackAuthQueryInvalidation() {
  const queryClient = useQueryClient()

  return {
    invalidateProject: async (projectId: string) => {
      await invalidateStackAuthQueries(queryClient, [
        stackAuthQueryKeys.project(projectId),
        stackAuthQueryKeys.projectConfig(projectId),
      ])
    },
    invalidateOwnedProjects: async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.ownedProjects(userId),
      })
    },
    invalidateCurrentUserTeams: async (userId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.currentUserTeams(userId),
      })
    },
    invalidateProjectConfig: async (projectId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.projectConfig(projectId),
      })
    },
    invalidateInternalApiKeys: async (projectId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.internalApiKeys(projectId),
      })
    },
    invalidateTeams: async (projectId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.teams(projectId),
      })
    },
    invalidateTeamMembers: async (projectId: string, teamId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.teamMembers(projectId, teamId),
      })
    },
    invalidatePermissionDefinitions: async (
      projectId: string,
      kind: "team" | "project"
    ) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.permissionDefinitions(projectId, kind),
      })
    },
    invalidateEmailThemes: async (projectId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.emailThemes(projectId),
      })
    },
    invalidateEmailTemplates: async (projectId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.emailTemplates(projectId),
      })
    },
    invalidateEmailDrafts: async (projectId: string) => {
      await queryClient.invalidateQueries({
        queryKey: stackAuthQueryKeys.emailDrafts(projectId),
      })
    },
  }
}
