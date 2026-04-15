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
  type DataGridColumnDef,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const [rows, setRows] = useState<ExtendedServerUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const hasDataRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const listOptions = useMemo((): NonNullable<Parameters<typeof stackAdminApp.listUsers>[0]> => {
    const common = {
      limit: PAGE_SIZE,
      orderBy: "signedUpAt" as const,
      desc: filters.signedUpOrder === "desc",
      query: filters.search || undefined,
      includeRestricted: filters.includeRestricted,
    };
    if (filters.onlyAnonymous) return { ...common, includeAnonymous: true, onlyAnonymous: true };
    return { ...common, includeAnonymous: filters.includeAnonymous };
  }, [filters, stackAdminApp]);

  const listOptionsRef = useRef(listOptions);
  listOptionsRef.current = listOptions;

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (hasDataRef.current) {
      setIsRefetching(true);
    } else {
      setIsLoading(true);
    }

    runAsynchronouslyWithAlert(async () => {
      const result = await stackAdminApp.listUsers(listOptions);
      if (controller.signal.aborted) return;
      const extended = extendUsers(result);
      setRows(extended);
      setNextCursor(result.nextCursor);
      hasDataRef.current = true;
      setIsLoading(false);
      setIsRefetching(false);
    });

    return () => controller.abort();
  }, [listOptions, stackAdminApp]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await stackAdminApp.listUsers({ ...listOptionsRef.current, cursor: nextCursor });
      const extended = extendUsers(result);
      setRows((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const newRows = extended.filter((r) => !existingIds.has(r.id));
        return [...prev, ...newRows];
      });
      setNextCursor(result.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore, stackAdminApp]);

  const [gridState, setGridState] = useState<DataGridState>(() => ({
    ...createDefaultDataGridState(USER_TABLE_COLUMNS),
    sorting: [{ columnId: "signedUpAt", direction: filters.signedUpOrder }],
  }));
  const trimmedQuickSearch = gridState.quickSearch.trim();

  const sortDirection = gridState.sorting.find((s) => s.columnId === "signedUpAt")?.direction ?? "desc";
  useEffect(() => {
    setFilters((prev) => (
      prev.signedUpOrder === sortDirection
        ? prev
        : { ...prev, signedUpOrder: sortDirection }
    ));
  }, [sortDirection, setFilters]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFilters((prev) => (
        prev.search === trimmedQuickSearch
          ? prev
          : { ...prev, search: trimmedQuickSearch }
      ));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [trimmedQuickSearch, setFilters]);

  const handleLoadMore = useCallback(() => {
    runAsynchronouslyWithAlert(loadMore);
  }, [loadMore]);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setGridState((prev) => (
      prev.quickSearch === ""
        ? prev
        : { ...prev, quickSearch: "" }
    ));
  }, [setFilters]);

  const filterValue = filters.onlyAnonymous ? "anonymous-only" : filters.includeAnonymous ? "anonymous" : filters.includeRestricted ? "restricted" : "standard";

  return (
    <DataGrid
      columns={USER_TABLE_COLUMNS}
      rows={rows}
      getRowId={(row) => row.id}
      isLoading={isLoading}
      isRefetching={isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={nextCursor != null}
      isLoadingMore={isLoadingMore}
      onLoadMore={handleLoadMore}
      footer={false}

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
        onClick={async () => {
          await navigator.clipboard.writeText(user.id);
          toast({ title: "Copied to clipboard", variant: "success" });
        }}
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
