// TODO(ui-fixes-minor): URL-synced query state (filter / search / page) was
// dropped when this table was migrated off `usePaginatedData` +
// `useUrlQueryState` + `useCursorPaginationCache`. Back-button and reload no
// longer restore the user's view. Restore via the same hooks (still in
// `./common/`) or call out the regression in the PR description before ship.
"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
  toast,
} from "@/components/ui";
import { CheckCircleIcon, CopyIcon, DotsThreeIcon, MagnifyingGlassIcon, XCircleIcon } from "@phosphor-icons/react";
import type { ServerUser } from "@stackframe/stack";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { Link } from "../link";
import { CreateCheckoutDialog } from "../payments/create-checkout-dialog";
import { DeleteUserDialog, ImpersonateUserDialog } from "../user-dialogs";

// ─── Types ───────────────────────────────────────────────────────────

export type ExtendedServerUser = ServerUser & {
  authTypes: string[],
  emailVerified: "verified" | "unverified",
};

type FilterState = {
  search: string,
  includeRestricted: boolean,
  includeAnonymous: boolean,
  onlyAnonymous: boolean,
  signedUpOrder: "asc" | "desc",
};

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_FILTERS: FilterState = {
  search: "",
  includeRestricted: true,
  includeAnonymous: false,
  onlyAnonymous: false,
  signedUpOrder: "desc",
};

const AUTH_TYPE_LABELS = new Map<string, string>([
  ["anonymous", "Anonymous"],
  ["otp", "Authenticator"],
  ["password", "Password"],
]);

// ─── Helpers ─────────────────────────────────────────────────────────

export function extendUsers(users: ServerUser[] & { nextCursor: string | null }): ExtendedServerUser[] & { nextCursor: string | null };
export function extendUsers(users: ServerUser[]): ExtendedServerUser[];
export function extendUsers(users: ServerUser[] & { nextCursor?: string | null }) {
  const extended = users.map((user) => {
    const authTypes = user.isAnonymous
      ? ["anonymous"]
      : [
        ...(user.otpAuthEnabled ? ["otp"] : []),
        ...(user.hasPassword ? ["password"] : []),
        ...user.oauthProviders.map((provider) => provider.id),
      ];
    return {
      ...user,
      authTypes,
      emailVerified: user.primaryEmailVerified ? "verified" : "unverified",
    } satisfies ExtendedServerUser;
  });
  return Object.assign(extended, { nextCursor: users.nextCursor ?? null });
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatUserId(id: string) {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

// ─── Column definitions ──────────────────────────────────────────────

const USER_TABLE_COLUMNS: DataGridColumnDef<ExtendedServerUser>[] = [
  {
    id: "user",
    header: "User",
    width: 180,
    flex: 1,
    sortable: false,
    renderCell: ({ row }) => <UserIdentityCell user={row} />,
  },
  {
    id: "email",
    header: "Email",
    width: 180,
    flex: 1,
    sortable: false,
    renderCell: ({ row }) => <UserEmailCell user={row} />,
  },
  {
    id: "userId",
    header: "User ID",
    width: 130,
    sortable: false,
    renderCell: ({ row }) => <UserIdCell user={row} />,
  },
  {
    id: "emailStatus",
    header: "Email Verified",
    width: 110,
    sortable: false,
    renderCell: ({ row }) => <EmailStatusCell user={row} />,
  },
  {
    id: "lastActiveAt",
    header: "Last active",
    width: 110,
    sortable: false,
    renderCell: ({ row }) => <DateMetaCell value={row.lastActiveAt} emptyLabel="Never" />,
  },
  {
    id: "auth",
    header: "Auth methods",
    width: 150,
    sortable: false,
    cellOverflow: "wrap",
    renderCell: ({ row }) => <AuthMethodsCell user={row} />,
  },
  {
    id: "signedUpAt",
    header: "Signed up",
    width: 110,
    renderCell: ({ row }) => <DateMetaCell value={row.signedUpAt} emptyLabel="Unknown" />,
  },
  {
    id: "actions",
    header: "",
    width: 44,
    minWidth: 44,
    maxWidth: 44,
    sortable: false,
    hideable: false,
    resizable: false,
    align: "right",
    renderCell: ({ row }) => <UserActions user={row} />,
  },
];

// ─── UserTable ───────────────────────────────────────────────────────

export function UserTable(props?: {
  onFilterChange?: (filters: { search?: string, includeRestricted: boolean, includeAnonymous: boolean, onlyAnonymous: boolean }) => void,
}) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const onFilterChange = props?.onFilterChange;
  useEffect(() => {
    onFilterChange?.({
      search: filters.search || undefined,
      includeRestricted: filters.includeRestricted,
      includeAnonymous: filters.includeAnonymous,
      onlyAnonymous: filters.onlyAnonymous,
    });
  }, [filters.search, filters.includeRestricted, filters.includeAnonymous, filters.onlyAnonymous, onFilterChange]);

  return <UserTableBody filters={filters} setFilters={setFilters} />;
}

// ─── Body (imperative fetching — no Suspense flash) ──────────────────

function UserTableBody(props: {
  filters: FilterState,
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>,
}) {
  const { filters, setFilters } = props;
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const [gridState, setGridState] = useState<DataGridState>(() => ({
    ...createDefaultDataGridState(USER_TABLE_COLUMNS),
    sorting: [{ columnId: "signedUpAt", direction: filters.signedUpOrder }],
  }));

  // Sync the sort header back into `filters` so the parent can persist it.
  const sortDirection = gridState.sorting.find((s) => s.columnId === "signedUpAt")?.direction ?? "desc";
  useEffect(() => {
    setFilters((prev) => (
      prev.signedUpOrder === sortDirection
        ? prev
        : { ...prev, signedUpOrder: sortDirection }
    ));
  }, [sortDirection, setFilters]);

  // Debounce the toolbar search input before it hits the server. The
  // visible input still updates instantly (via `gridState.quickSearch`);
  // only the fetch parameter is delayed.
  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    setFilters((prev) => (
      prev.search === debouncedQuickSearch
        ? prev
        : { ...prev, search: debouncedQuickSearch }
    ));
  }, [debouncedQuickSearch, setFilters]);

  // Server-side infinite data source. Re-created whenever a filter that
  // affects the query changes; useDataSource refetches from scratch on
  // identity change and continues paginating via the yielded nextCursor.
  const dataSource = useMemo<DataGridDataSource<ExtendedServerUser>>(
    () => async function* (params) {
      const search = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const sortDesc = params.sorting.find((s) => s.columnId === "signedUpAt")?.direction !== "asc";
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const result = filters.onlyAnonymous
        ? await stackAdminApp.listUsers({
          limit: PAGE_SIZE,
          orderBy: "signedUpAt",
          desc: sortDesc,
          query: search,
          includeRestricted: filters.includeRestricted,
          includeAnonymous: true,
          onlyAnonymous: true,
          cursor,
        })
        : await stackAdminApp.listUsers({
          limit: PAGE_SIZE,
          orderBy: "signedUpAt",
          desc: sortDesc,
          query: search,
          includeRestricted: filters.includeRestricted,
          includeAnonymous: filters.includeAnonymous,
          cursor,
        });
      yield {
        rows: extendUsers(result),
        hasMore: result.nextCursor != null,
        nextCursor: result.nextCursor ?? undefined,
      };
    },
    [stackAdminApp, filters.includeRestricted, filters.includeAnonymous, filters.onlyAnonymous],
  );

  const getRowId = useCallback((row: ExtendedServerUser) => row.id, []);

  const gridData = useDataSource({
    dataSource,
    columns: USER_TABLE_COLUMNS,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: debouncedQuickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setGridState((prev) => ({
      ...prev,
      quickSearch: "",
      sorting: [{ columnId: "signedUpAt", direction: DEFAULT_FILTERS.signedUpOrder }],
    }));
  }, [setFilters]);

  const filterValue = filters.onlyAnonymous ? "anonymous-only" : filters.includeAnonymous ? "anonymous" : filters.includeRestricted ? "restricted" : "standard";

  return (
    <DataGrid
      columns={USER_TABLE_COLUMNS}
      rows={gridData.rows}
      getRowId={getRowId}
      isLoading={gridData.isLoading}
      isRefetching={gridData.isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      rowHeight="auto"
      estimatedRowHeight={44}
      footer={false}
      fillHeight={false}

      toolbarExtra={
        <Select
          value={filterValue}
          onValueChange={(value) => {
            if (value === "anonymous-only") {
              setFilters((prev) => ({ ...prev, includeRestricted: true, includeAnonymous: true, onlyAnonymous: true }));
            } else if (value === "anonymous") {
              setFilters((prev) => ({ ...prev, includeRestricted: true, includeAnonymous: true, onlyAnonymous: false }));
            } else if (value === "restricted") {
              setFilters((prev) => ({ ...prev, includeRestricted: true, includeAnonymous: false, onlyAnonymous: false }));
            } else {
              setFilters((prev) => ({ ...prev, includeRestricted: false, includeAnonymous: false, onlyAnonymous: false }));
            }
          }}
        >
          <SelectTrigger className="w-[180px] h-8 text-xs" aria-label="User list filter">
            <SelectValue placeholder="Signups" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="standard">Exclude restricted</SelectItem>
            <SelectItem value="restricted">Signups</SelectItem>
            <SelectItem value="anonymous">Signups & anonymous</SelectItem>
            <SelectItem value="anonymous-only">Only anonymous</SelectItem>
          </SelectContent>
        </Select>
      }
      onRowClick={(row) => {
        router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(row.id)}`);
      }}
      emptyState={
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <MagnifyingGlassIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-base font-medium text-foreground">No users found</div>
          <p className="text-sm text-muted-foreground">Try adjusting your search or filters</p>
          <Button
            variant="outline"
            onClick={handleResetFilters}
          >
            Reset filters
          </Button>
        </div>
      }
    />
  );
}

// ─── Cell components ─────────────────────────────────────────────────

function UserActions(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(null);

  return (
    <div className="flex justify-end">
      <DeleteUserDialog user={user} open={isDeleteOpen} onOpenChange={setIsDeleteOpen} />
      <ImpersonateUserDialog user={user} impersonateSnippet={impersonateSnippet} onClose={() => setImpersonateSnippet(null)} />
      <CreateCheckoutDialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen} user={user} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="User actions">
            <DotsThreeIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={() =>
              router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(user.id)}`)
            }
          >
            View details
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              runAsynchronouslyWithAlert(async () => {
                const expiresInMillis = 1000 * 60 * 60 * 2;
                const expiresAtDate = new Date(Date.now() + expiresInMillis);
                const session = await user.createSession({ expiresInMillis, isImpersonation: true });
                const tokens = await session.getTokens();
                setImpersonateSnippet(
                  deindent`
                    document.cookie = 'stack-refresh-${stackAdminApp.projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/';
                    window.location.reload();
                  `,
                );
              })
            }
          >
            Impersonate
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsCheckoutOpen(true)}>Create checkout</DropdownMenuItem>
          {user.isMultiFactorRequired && (
            <DropdownMenuItem
              onClick={() =>
                runAsynchronouslyWithAlert(async () => {
                  await user.update({ totpMultiFactorSecret: null });
                })
              }
            >
              Remove 2FA
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsDeleteOpen(true)} className="text-destructive focus:text-destructive">
            Delete user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function UserIdentityCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const stackAdminApp = useAdminApp();
  const profileUrl = `/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(user.id)}`;
  const fallback = user.displayName?.charAt(0) ?? user.primaryEmail?.charAt(0) ?? "?";
  const displayName = user.displayName ?? user.primaryEmail ?? "Unnamed user";

  return (
    <div className="flex items-center gap-3">
      <Link href={profileUrl} className="rounded-full shrink-0">
        <Avatar className="h-6 w-6">
          <AvatarImage src={user.profileImageUrl ?? undefined} alt={user.displayName ?? user.primaryEmail ?? "User avatar"} />
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={profileUrl}
          className="block truncate text-sm font-semibold text-foreground hover:text-foreground"
          title={displayName}
        >
          {displayName}
        </Link>
      </div>
      {user.isAnonymous && (
        <Badge variant="secondary" className="text-xs shrink-0">Anonymous</Badge>
      )}
    </div>
  );
}

function UserIdCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  return (
    <SimpleTooltip tooltip="Copy user ID">
      <Button
        type="button"
        onClick={() => runAsynchronouslyWithAlert(async () => {
          await navigator.clipboard.writeText(user.id);
          toast({ title: "Copied to clipboard", variant: "success" });
        })}
        className="flex max-w-full px-1 py-0 h-min items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:transition-none hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer bg-transparent hover:bg-transparent"
        aria-label="Copy user ID"
        title={user.id}
      >
        <span className="truncate">{formatUserId(user.id)}</span>
        <CopyIcon className="h-3 w-3 shrink-0" />
      </Button>
    </SimpleTooltip>
  );
}

function UserEmailCell(props: { user: ExtendedServerUser }) {
  return (
    <span className="block max-w-full truncate text-sm text-muted-foreground" title={props.user.primaryEmail ?? undefined}>
      {props.user.primaryEmail ?? "No email"}
    </span>
  );
}

function EmailStatusCell(props: { user: ExtendedServerUser }) {
  const isVerified = props.user.emailVerified === "verified";
  return (
    <div className="flex items-center">
      {isVerified ? (
        <CheckCircleIcon className="h-4 w-4 text-success" aria-label="Email verified" />
      ) : (
        <XCircleIcon className="h-4 w-4 text-amber-500" aria-label="Email unverified" />
      )}
    </div>
  );
}

function AuthMethodsCell(props: { user: ExtendedServerUser }) {
  const authLabels = props.user.authTypes.length > 0 ? props.user.authTypes : ["none"];
  return (
    <div className="flex flex-wrap gap-1">
      {authLabels.map((type) => (
        <Badge key={type} variant="outline" className="bg-muted/60 text-[11px] text-muted-foreground px-1.5 py-0">
          {type === "none" ? "None" : AUTH_TYPE_LABELS.get(type) ?? titleCase(type)}
        </Badge>
      ))}
    </div>
  );
}

function DateMetaCell(props: { value: Date | string | null | undefined, emptyLabel: string }) {
  const { value, emptyLabel } = props;
  if (!value) return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap" title={date.toString()}>
      {fromNow(date)}
    </span>
  );
}
