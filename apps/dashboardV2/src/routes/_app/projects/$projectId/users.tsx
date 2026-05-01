import { Suspense, useCallback, useMemo, useState } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises"
import {
  CreditCardIcon,
  DotsThreeIcon,
  EyeIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import type { ServerUser } from "@stackframe/tanstack-start"
import type { InfiniteData } from "@tanstack/react-query"
import type { MetricsUserCounts } from "@stackframe/stack-shared/dist/interface/admin-metrics"

import type {
  VirtualDataGridColumn,
  VirtualDataGridSort,
} from "@/components/ui/virtual-data-grid"
import { cn } from "@/lib/utils"
import { formatRecentDashboardDate } from "@/lib/dates"
import { useAdminApp } from "@/lib/stack/admin-app"
import { useMetricsUserCountsQuery } from "@/lib/stack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  PROJECT_PAGE_HEADER_STICKY_TOP_CLASS,
  ProjectPage,
  ProjectPageHeader,
  ProjectPageMain,
} from "@/components/console/project-page"
import { VirtualDataGrid } from "@/components/ui/virtual-data-grid"
import {
  CreateCheckoutDialog,
  CreateUserDialog,
  DeleteUserDialog,
  ImpersonateUserDialog,
  UserAvatar,
} from "@/components/projects/users/user-detail-sheet"

const PAGE_SIZE = 20
const USERS_QUERY_GC_TIME_MS = 2 * 60 * 1000

type UsersSearch = {
  userId?: string
  teamId?: string
}

export const Route = createFileRoute("/_app/projects/$projectId/users")({
  validateSearch: (search: Record<string, unknown>): UsersSearch => ({
    userId: typeof search.userId === "string" ? search.userId : undefined,
    teamId: typeof search.teamId === "string" ? search.teamId : undefined,
  }),
  component: UsersPage,
})

const USERS_TABLE_FRAME_CLASS =
  "rounded-lg border [clip-path:inset(0_round_var(--radius-lg))]"

type SortableUserColumnId = "email-verified" | "last-active" | "signed-up"

type UsersInfinitePage = {
  items: Array<ServerUser>
  nextCursor?: string | null
}

function UsersPage() {
  return (
    <Suspense fallback={<UsersPageSkeleton />}>
      <UsersPageContent />
    </Suspense>
  )
}

function UsersPageContent() {
  const adminApp = useAdminApp()
  const metricsQuery = useMetricsUserCountsQuery(adminApp)
  const metrics = metricsQuery.data
  if (metrics == null) {
    return <UsersPageSkeleton />
  }

  return <UsersPageLoaded adminApp={adminApp} metrics={metrics} />
}

function UsersPageLoaded({
  adminApp,
  metrics,
}: {
  adminApp: ReturnType<typeof useAdminApp>
  metrics: MetricsUserCounts
}) {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const selectedUserId = search.userId ?? null
  const [sort, setSort] = useState<VirtualDataGridSort<SortableUserColumnId>>({
    id: "signed-up",
    desc: true,
  })
  const signedUpUsersCount = metrics.total_users - metrics.anonymous_users
  const serverQuery = query.trim()

  const queryKey = useMemo(
    () => ["users-list", adminApp.projectId, serverQuery] as const,
    [adminApp.projectId, serverQuery]
  )

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery<
      UsersInfinitePage,
      Error,
      InfiniteData<UsersInfinitePage, string | undefined>,
      typeof queryKey,
      string | undefined
    >({
      queryKey,
      queryFn: async ({ pageParam }) => {
        const page = await adminApp.listUsers({
          limit: PAGE_SIZE,
          cursor: pageParam,
          query: serverQuery === "" ? undefined : serverQuery,
          includeRestricted: true,
        })
        return { items: [...page], nextCursor: page.nextCursor }
      },
      initialPageParam: undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      gcTime: USERS_QUERY_GC_TIME_MS,
    })
  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  )
  const sortedItems = useMemo(() => sortUsers(items, sort), [items, sort])
  const invalidateUsers = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["users-list", adminApp.projectId],
    })
  }, [adminApp.projectId, queryClient])
  const setSelectedUserId = useCallback(
    (userId: string | null) => {
      runAsynchronouslyWithAlert(
        navigate({
          to: "/projects/$projectId/users",
          params: { projectId: adminApp.projectId },
          search: (previous) => ({
            ...previous,
            userId: userId ?? undefined,
            teamId: undefined,
          }),
          resetScroll: false,
        })
      )
    },
    [adminApp.projectId, navigate]
  )
  const toggleSort = useCallback((id: SortableUserColumnId) => {
    setSort((current) =>
      current.id === id
        ? { id, desc: !current.desc }
        : { id, desc: id !== "email-verified" }
    )
  }, [])
  const usersTableColumns = useUsersTableColumns({
    onViewDetails: setSelectedUserId,
    onUsersChanged: invalidateUsers,
  })

  const isSearching = query.trim().length > 0
  const isEmpty = !isLoading && items.length === 0 && !hasNextPage
  const showProjectEmptyState = isEmpty && !isSearching

  return (
    <ProjectPage>
      <ProjectPageHeader
        title="Users"
        badge={
          <Badge variant="secondary">
            {signedUpUsersCount.toLocaleString()}
          </Badge>
        }
        actions={
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <UserPlusIcon />
            New user
          </Button>
        }
      />

      <ProjectPageMain className="py-4">
        {showProjectEmptyState ? (
          <UsersEmpty onCreate={() => setCreateOpen(true)} />
        ) : (
          <VirtualDataGrid
            columns={usersTableColumns}
            items={sortedItems}
            getItemKey={(user) => user.id}
            totalCount={isSearching ? undefined : signedUpUsersCount}
            isLoading={isLoading}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            searchValue={query}
            onSearchValueChange={setQuery}
            searchPlaceholder="Search by name or email"
            isSearching={isSearching}
            emptyMessage={`No users match "${query}".`}
            sort={sort}
            onSortChange={toggleSort}
            selectedItemKey={selectedUserId}
            onSelectItemKey={setSelectedUserId}
            keyboardNavigationDisabled={createOpen}
            frameClassName={USERS_TABLE_FRAME_CLASS}
            stickyTopClassName={PROJECT_PAGE_HEADER_STICKY_TOP_CLASS}
          />
        )}
      </ProjectPageMain>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={invalidateUsers}
      />
    </ProjectPage>
  )
}

function UsersPageSkeleton() {
  return (
    <ProjectPage>
      <ProjectPageHeader
        title={<Skeleton className="h-5 w-16" />}
        badge={<Skeleton className="h-5 w-12 rounded-full" />}
        actions={<Skeleton className="h-10 w-28 rounded-md" />}
      />

      <ProjectPageMain className="py-4">
        <VirtualDataGrid
          columns={getUsersTableColumns({
            onViewDetails: () => {},
            onUsersChanged: async () => {},
          })}
          items={[]}
          getItemKey={(user) => user.id}
          isLoading
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={async () => {}}
          searchValue=""
          onSearchValueChange={() => {}}
          searchPlaceholder="Search by name or email"
          isSearching={false}
          emptyMessage=""
          sort={{ id: "signed-up", desc: true }}
          onSortChange={() => {}}
          selectedItemKey={null}
          onSelectItemKey={() => {}}
          frameClassName={cn(
            "flex min-h-0 flex-1 flex-col",
            USERS_TABLE_FRAME_CLASS
          )}
          stickyTopClassName={PROJECT_PAGE_HEADER_STICKY_TOP_CLASS}
        />
      </ProjectPageMain>
    </ProjectPage>
  )
}

function useUsersTableColumns({
  onViewDetails,
  onUsersChanged,
}: {
  onViewDetails: (userId: string) => void
  onUsersChanged: () => Promise<void>
}) {
  return useMemo(
    () => getUsersTableColumns({ onViewDetails, onUsersChanged }),
    [onUsersChanged, onViewDetails]
  )
}

function getUsersTableColumns({
  onViewDetails,
  onUsersChanged,
}: {
  onViewDetails: (userId: string) => void
  onUsersChanged: () => Promise<void>
}): Array<VirtualDataGridColumn<ServerUser, SortableUserColumnId>> {
  return [
    {
      id: "user",
      label: "User",
      width: "minmax(0,1.35fr)",
      renderCell: (user) => <UserIdentityCell user={user} />,
      renderSkeleton: () => (
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="size-10 rounded-full" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ),
    },
    {
      id: "email",
      label: "Email",
      width: "minmax(0,1.75fr)",
      renderCell: (user) => (
        <span className="min-w-0 truncate text-sm">
          {user.primaryEmail ?? (
            <span className="text-muted-foreground">-</span>
          )}
        </span>
      ),
      renderSkeleton: () => <Skeleton className="h-4 w-full max-w-[220px]" />,
    },
    {
      id: "id",
      label: "ID",
      width: "minmax(0,0.7fr)",
      renderCell: (user) => <TruncatedUserIdCell id={user.id} />,
      renderSkeleton: () => <Skeleton className="h-4 w-16" />,
    },
    {
      id: "email-verified",
      label: "Email verified",
      width: "minmax(0,0.85fr)",
      sortable: "email-verified",
      renderCell: (user) => (
        <Badge variant={user.primaryEmailVerified ? "default" : "secondary"}>
          {user.primaryEmailVerified ? "Verified" : "Unverified"}
        </Badge>
      ),
      renderSkeleton: () => <Skeleton className="h-5 w-20 rounded-full" />,
    },
    {
      id: "last-active",
      label: "Last active",
      width: "minmax(0,0.9fr)",
      sortable: "last-active",
      renderCell: (user) => <UserDateCell date={user.lastActiveAt} />,
      renderSkeleton: () => <Skeleton className="h-4 w-24" />,
    },
    {
      id: "auth-methods",
      label: "Auth methods",
      width: "minmax(0,1.1fr)",
      renderCell: (user) => <AuthMethodsCell user={user} />,
      cellClassName: "gap-1",
      renderSkeleton: () => (
        <>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </>
      ),
    },
    {
      id: "signed-up",
      label: "Signed up",
      width: "minmax(0,0.9fr)",
      sortable: "signed-up",
      renderCell: (user) => <UserDateCell date={user.signedUpAt} />,
      renderSkeleton: () => <Skeleton className="h-4 w-24" />,
    },
    {
      id: "actions",
      label: "Actions",
      width: "3.5rem",
      headerClassName: "justify-end",
      cellClassName: "justify-end",
      renderCell: (user) => (
        <UserActionsMenu
          user={user}
          onViewDetails={() => onViewDetails(user.id)}
          onDeleted={onUsersChanged}
        />
      ),
      renderSkeleton: () => <Skeleton className="size-6 rounded-md" />,
    },
  ]
}

function sortUsers(
  users: ReadonlyArray<ServerUser>,
  sort: VirtualDataGridSort<SortableUserColumnId>
): Array<ServerUser> {
  return [...users].sort((a, b) => {
    const compared = compareUsersByColumn(a, b, sort.id)
    const directed = sort.desc ? -compared : compared
    return directed === 0 ? a.id.localeCompare(b.id) : directed
  })
}

function compareUsersByColumn(
  a: ServerUser,
  b: ServerUser,
  columnId: SortableUserColumnId
) {
  switch (columnId) {
    case "email-verified": {
      return Number(a.primaryEmailVerified) - Number(b.primaryEmailVerified)
    }
    case "last-active": {
      return a.lastActiveAt.getTime() - b.lastActiveAt.getTime()
    }
    case "signed-up": {
      return a.signedUpAt.getTime() - b.signedUpAt.getTime()
    }
  }
  return 0
}

function UserDateCell({ date }: { date: Date | null }) {
  return (
    <span
      className="min-w-0 truncate text-sm text-muted-foreground"
      title={date == null ? undefined : formatLongDateLocal(date)}
    >
      {formatRecentDashboardDate(date)}
    </span>
  )
}

function formatLongDateLocal(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function UserIdentityCell({ user }: { user: ServerUser }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <UserAvatar user={user} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {user.displayName ?? (
            <span className="text-muted-foreground">No name</span>
          )}
        </p>
        {user.isAnonymous ? (
          <p className="truncate text-[10px] text-muted-foreground">
            Anonymous
          </p>
        ) : null}
      </div>
    </div>
  )
}

function TruncatedUserIdCell({ id }: { id: string }) {
  return (
    <code
      className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
      title={id}
    >
      {truncateUserId(id)}
    </code>
  )
}

function AuthMethodsCell({ user }: { user: ServerUser }) {
  const methods = getAuthMethodLabels(user)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {methods.map((method) => (
        <Badge key={method} variant="secondary" className="max-w-24 truncate">
          {method}
        </Badge>
      ))}
    </div>
  )
}

function getAuthMethodLabels(user: ServerUser): Array<string> {
  const methods: Array<string> = []

  if (user.hasPassword) methods.push("Password")
  if (user.otpAuthEnabled) methods.push("Email OTP")
  if (user.passkeyAuthEnabled) methods.push("Passkey")
  for (const provider of user.oauthProviders) {
    methods.push(formatOAuthProviderLabel(provider.id))
  }
  if (user.isAnonymous) methods.push("Anonymous")

  return methods.length > 0 ? methods : ["None"]
}

function formatOAuthProviderLabel(providerId: string): string {
  return providerId.charAt(0).toUpperCase() + providerId.slice(1)
}

function UserActionsMenu({
  user,
  onViewDetails,
  onDeleted,
}: {
  user: ServerUser
  onViewDetails: () => void
  onDeleted: () => Promise<void>
}) {
  const adminApp = useAdminApp()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(
    null
  )

  const handleImpersonate = async () => {
    const expiresInMillis = 1000 * 60 * 60 * 2
    const expiresAtDate = new Date(new Date().getTime() + expiresInMillis)
    const session = await user.createSession({
      expiresInMillis,
      isImpersonation: true,
    })
    const tokens = await session.getTokens()
    if (tokens.refreshToken == null) {
      throw new Error("Impersonation session did not return a refresh token.")
    }

    setImpersonateSnippet(
      [
        `document.cookie = 'stack-refresh-${adminApp.projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/';`,
        "window.location.reload();",
      ].join("\n")
    )
  }

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open actions for ${user.displayName ?? user.primaryEmail ?? user.id}`}
            />
          }
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={onViewDetails}>
            <EyeIcon />
            View details
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              runAsynchronouslyWithAlert(handleImpersonate)
            }}
          >
            <UsersIcon />
            Impersonate
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCheckoutOpen(true)}>
            <CreditCardIcon />
            Create checkout
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon />
            Delete user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImpersonateUserDialog
        snippet={impersonateSnippet}
        onClose={() => setImpersonateSnippet(null)}
      />
      <CreateCheckoutDialog
        user={user}
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
      />
      <DeleteUserDialog
        user={user}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          setDeleteOpen(false)
          runAsynchronouslyWithAlert(onDeleted)
        }}
      />
    </div>
  )
}

function UsersEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>No users yet</EmptyTitle>
          <EmptyDescription>
            Users sign up through your app's auth pages, or you can create one
            manually for testing.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon />
            New user
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

function truncateUserId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
