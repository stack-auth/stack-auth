"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import type { ServerUser, StackAdminApp } from "@stackframe/stack";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleTooltip,
  Skeleton,
  toast,
} from "@stackframe/stack-ui";
import {
  ColumnDef,
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Copy, MoreHorizontal, Search, X, XCircle } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { Link } from "../link";
import { CreateCheckoutDialog } from "../payments/create-checkout-dialog";
import { DeleteUserDialog, ImpersonateUserDialog } from "../user-dialogs";
import { useCursorPaginationCache } from "./common/cursor-pagination";
import { PaginationControls } from "./common/pagination";
import { useStableValue } from "./common/stable-value";
import {
  DEFAULT_ROW_HEIGHT_PX,
  TableContent,
  type ColumnLayout,
  type ColumnMeta,
} from "./common/table";
import { TableSkeleton } from "./common/table-skeleton";
import { useUrlQueryState } from "./common/url-query-state";

type QueryState = {
  search?: string,
  includeAnonymous: boolean,
  page: number,
  pageSize: number,
  cursor?: string,
  signedUpOrder: "asc" | "desc",
};

type QueryUpdater =
  | Partial<QueryState>
  | ((prev: QueryState) => Partial<QueryState>);

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const SEARCH_DEBOUNCE_MS = 250;

export type ExtendedServerUser = ServerUser & {
  authTypes: string[],
  emailVerified: "verified" | "unverified",
};

const AUTH_TYPE_LABELS = new Map<string, string>([
  ["anonymous", "Anonymous"],
  ["otp", "Authenticator"],
  ["password", "Password"],
]);

export const USER_COMMON_COLUMN_LAYOUT: ColumnLayout<"user" | "email" | "userId" | "emailStatus" | "lastActiveAt"> = {
  user: { size: 160, minWidth: 110, maxWidth: 160, width: "clamp(110px, 22vw, 160px)" },
  email: { size: 160, minWidth: 110, maxWidth: 160, width: "clamp(110px, 22vw, 160px)" },
  userId: { size: 130, minWidth: 90, maxWidth: 130, width: "clamp(90px, 18vw, 130px)" },
  emailStatus: { size: 110, minWidth: 80, maxWidth: 110, width: "clamp(80px, 16vw, 110px)" },
  lastActiveAt: { size: 110, minWidth: 80, maxWidth: 110, width: "clamp(80px, 16vw, 110px)" },
};

type ColumnKey =
  | "user"
  | "email"
  | "userId"
  | "emailStatus"
  | "lastActiveAt"
  | "auth"
  | "signedUpAt"
  | "actions";

type ColumnLayoutMap = ColumnLayout<ColumnKey>;
type ColumnMetaType = ColumnMeta<ColumnKey>;

const ROW_HEIGHT_PX = DEFAULT_ROW_HEIGHT_PX;

const COLUMN_LAYOUT: ColumnLayoutMap = {
  ...USER_COMMON_COLUMN_LAYOUT,
  auth: { size: 150, minWidth: 110, maxWidth: 150, width: "clamp(110px, 20vw, 150px)" },
  signedUpAt: { size: 110, minWidth: 80, maxWidth: 110, width: "clamp(80px, 16vw, 110px)" },
  actions: {
    size: 40,
    minWidth: 40,
    maxWidth: 40,
    width: "clamp(40px, 10vw, 40px)",
    headerClassName: "text-right",
    cellClassName: "text-right",
  },
};

const DEFAULT_QUERY_STATE: QueryState = {
  includeAnonymous: false,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  signedUpOrder: "desc",
};

const numberTransform = (_value: unknown, originalValue: unknown) => {
  if (typeof originalValue === "number" && Number.isFinite(originalValue)) {
    return originalValue;
  }
  if (typeof originalValue === "string") {
    const trimmed = originalValue.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const optionalStringTransform = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const querySchema = yup.object({
  search: yup
    .string()
    .transform((_, originalValue) => optionalStringTransform(originalValue))
    .optional(),
  includeAnonymous: yup
    .boolean()
    .transform((_, originalValue) => (originalValue === "true" ? true : undefined))
    .optional(),
  page: yup
    .number()
    .transform(numberTransform)
    .integer()
    .positive()
    .optional(),
  pageSize: yup
    .number()
    .transform(numberTransform)
    .integer()
    .positive()
    .optional(),
  cursor: yup
    .string()
    .transform((_, originalValue) => optionalStringTransform(originalValue))
    .optional(),
  signedUpOrder: yup
    .mixed<"asc" | "desc">()
    .transform((_, originalValue) => (originalValue === "asc" || originalValue === "desc" ? originalValue : undefined))
    .optional(),
});

const columnHelper = createColumnHelper<ExtendedServerUser>();

export function UserTable() {
  const stackAdminApp = useAdminApp();
  const { query, setQuery } = useUserTableQueryState();
  const [searchInput, setSearchInput] = useState(query.search ?? "");
  const {
    resetCache,
    readCursorForPage,
    recordPageCursor,
    recordNextCursor,
    prefetchCursor,
  } = useCursorPaginationCache();

  useEffect(() => {
    setSearchInput(query.search ?? "");
  }, [query.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const normalized = trimmed.length === 0 ? undefined : trimmed;
    if (normalized === (query.search ?? undefined)) {
      return;
    }
    const handle = setTimeout(() => {
      setQuery((prev) => ({
        ...prev,
        page: 1,
        cursor: undefined,
        search: normalized,
      }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, query.search, setQuery]);

  useEffect(() => {
    resetCache();
  }, [resetCache, query.search, query.includeAnonymous, query.pageSize, query.signedUpOrder]);

  useEffect(() => {
    if (query.page > 1 && !query.cursor) {
      setQuery((prev) => ({ ...prev, page: 1, cursor: undefined }));
    }
  }, [query.page, query.cursor, setQuery]);

  return (
    <section className="space-y-4">
      <UserTableHeader
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        includeAnonymous={query.includeAnonymous}
        onIncludeAnonymousChange={(value) =>
          setQuery((prev) => ({ ...prev, includeAnonymous: value, page: 1, cursor: undefined }))
        }
      />
      <div className="overflow-clip rounded-xl border border-border bg-card shadow-sm">
        <Suspense fallback={<UserTableSkeleton pageSize={query.pageSize} />}>
          <UserTableBody
            stackAdminApp={stackAdminApp}
            query={query}
            setQuery={setQuery}
            readCursorForPage={readCursorForPage}
            recordPageCursor={recordPageCursor}
            recordNextCursor={recordNextCursor}
            prefetchCursor={prefetchCursor}
            resetCursorCache={resetCache}
          />
        </Suspense>
      </div>
    </section>
  );
}

function UserTableHeader(props: {
  searchValue: string,
  onSearchChange: (value: string) => void,
  includeAnonymous: boolean,
  onIncludeAnonymousChange: (value: boolean) => void,
}) {
  const { searchValue, onSearchChange, includeAnonymous, onIncludeAnonymousChange } = props;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4 md:flex-1 justify-between">
        <div className="relative flex-1 min-w-[220px] max-w-[320px]">
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search table"
            className="!px-8"
            autoComplete="off"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          {searchValue.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Select
            value={includeAnonymous ? "include" : "standard"}
            onValueChange={(value) => onIncludeAnonymousChange(value === "include")}
          >
            <SelectTrigger className="w-[180px]" aria-label="User list filter">
              <SelectValue placeholder="Exclude Anonymous" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="standard">Exclude Anonymous</SelectItem>
              <SelectItem value="include">Include Anonymous</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

function UserTableBody(props: {
  stackAdminApp: StackAdminApp<false>,
  query: QueryState,
  setQuery: (updater: QueryUpdater) => void,
  readCursorForPage: (page: number) => string | null | undefined,
  recordPageCursor: (page: number, cursor: string | null | undefined) => void,
  recordNextCursor: (page: number, nextCursor: string | null | undefined) => void,
  prefetchCursor: (cursor: string | null | undefined, task: () => void | Promise<void>) => void,
  resetCursorCache: () => void,
}) {
  const {
    stackAdminApp,
    query,
    setQuery,
    readCursorForPage,
    recordPageCursor,
    recordNextCursor,
    prefetchCursor,
    resetCursorCache,
  } = props;

  const baseOptions = useMemo(
    () => ({
      limit: query.pageSize,
      orderBy: "signedUpAt" as const,
      desc: query.signedUpOrder === "desc",
      query: query.search,
      includeAnonymous: query.includeAnonymous,
    }),
    [query.pageSize, query.search, query.includeAnonymous, query.signedUpOrder],
  );

  const storedCursor = readCursorForPage(query.page);
  const cursorToUse = useMemo(() => {
    if (query.page === 1) {
      return undefined;
    }
    if (storedCursor && storedCursor.length > 0) {
      return storedCursor;
    }
    if (storedCursor === null) {
      return undefined;
    }
    if (query.cursor) {
      return query.cursor;
    }
    return undefined;
  }, [query.page, query.cursor, storedCursor]);

  const listOptions = useMemo(
    () => ({
      ...baseOptions,
      cursor: cursorToUse,
    }),
    [baseOptions, cursorToUse],
  );

  const rawUsers = stackAdminApp.useUsers(listOptions);
  const usersFingerprint = useMemo(() => getUsersFingerprint(rawUsers), [rawUsers]);
  const stableRawUsers = useStableValue(rawUsers, usersFingerprint);
  const users = useMemo(() => extendUsers(stableRawUsers), [stableRawUsers]);

  useEffect(() => {
    recordPageCursor(query.page, query.page === 1 ? null : cursorToUse ?? null);
  }, [query.page, cursorToUse, recordPageCursor]);

  useEffect(() => {
    recordNextCursor(query.page, users.nextCursor);
  }, [query.page, users.nextCursor, recordNextCursor]);

  useEffect(() => {
    prefetchCursor(users.nextCursor, () =>
      runAsynchronously(
        stackAdminApp.listUsers({
          ...baseOptions,
          cursor: users.nextCursor ?? undefined,
        }),
      ),
    );
  }, [users.nextCursor, stackAdminApp, baseOptions, prefetchCursor]);

  const columns = useMemo<ColumnDef<ExtendedServerUser>[]>(
    () => createUserColumns(setQuery, query.signedUpOrder === "desc"),
    [setQuery, query.signedUpOrder],
  );

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const hasResults = users.length > 0;
  const hasNextPage = users.nextCursor !== null;
  const hasPreviousPage = query.page > 1;

  return (
    <div className="flex flex-col">
      <TableContent
        table={table}
        columnLayout={COLUMN_LAYOUT}
        hasResults={hasResults}
        rowHeightPx={ROW_HEIGHT_PX}
        renderEmptyState={() => (
          <div className="mx-auto flex max-w-md flex-col items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-base font-medium text-foreground">No users found</div>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search or filters. You can also reset everything and start again.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                resetCursorCache();
                setQuery({ search: undefined, includeAnonymous: false, page: 1, cursor: undefined });
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
      />
      <PaginationControls
        page={query.page}
        pageSize={query.pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        hasNextPage={hasNextPage}
        hasPreviousPage={hasPreviousPage}
        onPageSizeChange={(value) =>
          setQuery((prev) => ({ ...prev, pageSize: value, page: 1, cursor: undefined }))
        }
        onPreviousPage={() => {
          if (!hasPreviousPage) {
            return;
          }
          const previousPage = query.page - 1;
          const previousCursor = readCursorForPage(previousPage);
          setQuery({ page: previousPage, cursor: previousPage === 1 ? undefined : previousCursor ?? undefined });
        }}
        onNextPage={() => {
          if (!hasNextPage) {
            return;
          }
          setQuery({ page: query.page + 1, cursor: users.nextCursor ?? undefined });
        }}
        selectAriaLabel={`Rows per page: ${query.pageSize}`}
      />
    </div>
  );
}

function UserTableSkeleton(props: { pageSize: number }) {
  const { pageSize } = props;
  const columnOrder: ColumnKey[] = [
    "user",
    "email",
    "userId",
    "emailStatus",
    "lastActiveAt",
    "auth",
    "signedUpAt",
    "actions",
  ];
  const skeletonHeaders: Record<ColumnKey, string | null> = {
    user: "User",
    email: "Email",
    userId: "User ID",
    emailStatus: "Email status",
    lastActiveAt: "Last active",
    auth: "Auth methods",
    signedUpAt: "Signed up",
    actions: null,
  };
  const renderSkeletonCellContent = (columnKey: ColumnKey): JSX.Element => {
    switch (columnKey) {
      case "user": {
        return (
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-full max-w-[160px]" />
            </div>
          </div>
        );
      }
      case "email": {
        return <Skeleton className="h-3 w-full max-w-[160px]" />;
      }
      case "userId": {
        return <Skeleton className="h-3 w-full max-w-[130px]" />;
      }
      case "emailStatus": {
        return <Skeleton className="h-3 w-full max-w-[110px]" />;
      }
      case "lastActiveAt": {
        return <Skeleton className="h-3 w-full max-w-[110px]" />;
      }
      case "auth": {
        return (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-5 w-full max-w-[150px] rounded-full" />
          </div>
        );
      }
      case "signedUpAt": {
        return <Skeleton className="h-3 w-full max-w-[110px]" />;
      }
      case "actions": {
        return <Skeleton className="ml-auto h-4 w-4" />;
      }
      default: {
        const exhaustiveCheck: never = columnKey;
        throw new Error("Unhandled skeleton column");
      }
    }
  };

  return (
    <div className="flex flex-col">
      <TableSkeleton
        columnOrder={columnOrder}
        columnLayout={COLUMN_LAYOUT}
        headerLabels={skeletonHeaders}
        rowCount={pageSize}
        rowHeightPx={ROW_HEIGHT_PX}
        renderCellSkeleton={(columnKey) => renderSkeletonCellContent(columnKey)}
      />
      <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            Page …
          </span>
          <Button variant="ghost" size="sm" disabled>
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function createUserColumns(
  setQuery: (updater: QueryUpdater) => void,
  isSignedUpDesc: boolean,
): ColumnDef<ExtendedServerUser>[] {
  const toggleSignedUpOrder = () =>
    setQuery((prev) => ({
      signedUpOrder: prev.signedUpOrder === "desc" ? "asc" : "desc",
      page: 1,
      cursor: undefined,
    }));

  return [
    ...getCommonUserColumns<ExtendedServerUser>(),
    columnHelper.display({
      id: "auth",
      size: COLUMN_LAYOUT.auth.size,
      minSize: COLUMN_LAYOUT.auth.minWidth,
      maxSize: COLUMN_LAYOUT.auth.maxWidth,
      meta: { columnKey: "auth" } as ColumnMetaType,
      header: () => <span className="text-xs font-semibold tracking-wide">Auth methods</span>,
      cell: ({ row }) => <AuthMethodsCell user={row.original} />,
    }),
    columnHelper.display({
      id: "signedUpAt",
      size: COLUMN_LAYOUT.signedUpAt.size,
      minSize: COLUMN_LAYOUT.signedUpAt.minWidth,
      maxSize: COLUMN_LAYOUT.signedUpAt.maxWidth,
      meta: { columnKey: "signedUpAt" } as ColumnMetaType,
      header: () => (
        <button
          type="button"
          onClick={toggleSignedUpOrder}
          className="inline-flex items-center gap-1 text-xs font-semibold tracking-wide text-muted-foreground transition hover:text-foreground focus:outline-none"
          aria-label={`Sort by signed up (${isSignedUpDesc ? "newest first" : "oldest first"})`}
        >
          <span>Signed up</span>
          {isSignedUpDesc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
        </button>
      ),
      cell: ({ row }) => <DateMetaCell value={row.original.signedUpAt} emptyLabel="Unknown" />,
    }),
    columnHelper.display({
      id: "actions",
      size: COLUMN_LAYOUT.actions.size,
      minSize: COLUMN_LAYOUT.actions.minWidth,
      maxSize: COLUMN_LAYOUT.actions.maxWidth,
      meta: { columnKey: "actions" } as ColumnMetaType,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <UserActions user={row.original} />,
    }),
  ];
}

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
            <MoreHorizontal className="h-4 w-4" />
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

function getUsersFingerprint(users: ServerUser[] & { nextCursor: string | null }) {
  const userSegments = users
    .map((user) => [
      user.id,
      user.displayName ?? "",
      user.primaryEmail ?? "",
      user.primaryEmailVerified ? "1" : "0",
      user.isAnonymous ? "1" : "0",
      normalizeDateValue(user.lastActiveAt),
      normalizeDateValue(user.signedUpAt),
      user.otpAuthEnabled ? "1" : "0",
      user.hasPassword ? "1" : "0",
      user.profileImageUrl ?? "",
      user.isMultiFactorRequired ? "1" : "0",
      user.oauthProviders.map((provider) => provider.id).sort().join(","),
    ].join("~"))
    .join("||");
  return `${users.nextCursor ?? ""}::${userSegments}`;
}

function normalizeDateValue(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return String(date.getTime());
}

function sanitizeQueryState(state: Partial<QueryState>): QueryState {
  const search = state.search?.trim() ? state.search.trim() : undefined;
  const includeAnonymous = Boolean(state.includeAnonymous);
  const candidatePageSize = state.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(candidatePageSize) ? candidatePageSize : DEFAULT_PAGE_SIZE;
  const candidatePage = state.page ?? 1;
  const page = Number.isFinite(candidatePage) ? Math.max(1, Math.floor(candidatePage)) : 1;
  const cursor = page > 1 && state.cursor ? state.cursor : undefined;
  const signedUpOrder = state.signedUpOrder === "asc" ? "asc" : "desc";
  return { search, includeAnonymous, page, pageSize, cursor, signedUpOrder };
}

function serializeQueryState(state: QueryState) {
  const params = new URLSearchParams();
  if (state.search) {
    params.set("search", state.search);
  }
  if (state.includeAnonymous) {
    params.set("includeAnonymous", "true");
  }
  if (state.page > 1) {
    params.set("page", String(state.page));
  }
  if (state.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(state.pageSize));
  }
  if (state.signedUpOrder !== "desc") {
    params.set("signedUpOrder", state.signedUpOrder);
  }
  if (state.cursor) {
    params.set("cursor", state.cursor);
  }
  return params;
}

function useUserTableQueryState() {
  const { state, setState } = useUrlQueryState<QueryState>({
    schema: querySchema,
    defaultState: DEFAULT_QUERY_STATE,
    sanitize: sanitizeQueryState,
    serialize: serializeQueryState,
  });
  return { query: state, setQuery: setState };
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatUserId(id: string) {
  if (id.length <= 10) {
    return id;
  }
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

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

export function getCommonUserColumns<T extends ExtendedServerUser>(): ColumnDef<T>[] {
  const helper = createColumnHelper<T>();
  return [
    helper.display({
      id: "user",
      size: COLUMN_LAYOUT.user.size,
      minSize: COLUMN_LAYOUT.user.minWidth,
      maxSize: COLUMN_LAYOUT.user.maxWidth,
      meta: { columnKey: "user" } as ColumnMetaType,
      header: () => <span className="text-xs font-semibold tracking-wide">User</span>,
      cell: ({ row }) => <UserIdentityCell user={row.original} />,
    }),
    helper.display({
      id: "email",
      size: COLUMN_LAYOUT.email.size,
      minSize: COLUMN_LAYOUT.email.minWidth,
      maxSize: COLUMN_LAYOUT.email.maxWidth,
      meta: { columnKey: "email" } as ColumnMetaType,
      header: () => <span className="text-xs font-semibold tracking-wide">Email</span>,
      cell: ({ row }) => <UserEmailCell user={row.original} />,
    }),
    helper.display({
      id: "userId",
      size: COLUMN_LAYOUT.userId.size,
      minSize: COLUMN_LAYOUT.userId.minWidth,
      maxSize: COLUMN_LAYOUT.userId.maxWidth,
      meta: { columnKey: "userId" } as ColumnMetaType,
      header: () => <span className="text-xs font-semibold tracking-wide">User ID</span>,
      cell: ({ row }) => <UserIdCell user={row.original} />,
    }),
    helper.display({
      id: "emailStatus",
      size: COLUMN_LAYOUT.emailStatus.size,
      minSize: COLUMN_LAYOUT.emailStatus.minWidth,
      maxSize: COLUMN_LAYOUT.emailStatus.maxWidth,
      meta: { columnKey: "emailStatus" } as ColumnMetaType,
      header: () => <span className="text-xs font-semibold tracking-wide">Email status</span>,
      cell: ({ row }) => <EmailStatusCell user={row.original} />,
    }),
    helper.display({
      id: "lastActiveAt",
      size: COLUMN_LAYOUT.lastActiveAt.size,
      minSize: COLUMN_LAYOUT.lastActiveAt.minWidth,
      maxSize: COLUMN_LAYOUT.lastActiveAt.maxWidth,
      meta: { columnKey: "lastActiveAt" } as ColumnMetaType,
      header: () => <span className="text-xs font-semibold tracking-wide">Last active</span>,
      cell: ({ row }) => <DateMetaCell value={row.original.lastActiveAt} emptyLabel="Never" />,
    }),
  ];
}

function UserIdentityCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const stackAdminApp = useAdminApp();
  const profileUrl = `/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(user.id)}`;
  const fallback = user.displayName?.charAt(0) ?? user.primaryEmail?.charAt(0) ?? "?";
  const displayName = user.displayName ?? user.primaryEmail ?? "Unnamed user";

  return (
    <div className="flex items-center gap-3">
      <Link href={profileUrl} className="rounded-full">
        <Avatar className="h-6 w-6">
          <AvatarImage src={user.profileImageUrl ?? undefined} alt={user.displayName ?? user.primaryEmail ?? "User avatar"} />
          <AvatarFallback>{fallback}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={profileUrl}
            className="max-w-full text-sm font-semibold text-foreground hover:text-foreground"
          >
            <span className="block truncate" title={displayName}>
              {displayName}
            </span>
          </Link>
          {user.isAnonymous && (
            <Badge variant="secondary" className="text-xs">
              Anonymous
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function UserEmailCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const email = user.primaryEmail ?? "No email";

  return (
    <span className="block max-w-full truncate text-sm text-muted-foreground" title={user.primaryEmail ?? undefined}>
      {email}
    </span>
  );
}

function UserIdCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const idLabel = formatUserId(user.id);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(user.id);
    toast({ title: "Copied to clipboard", variant: "success" });
  };

  return (
    <SimpleTooltip tooltip="Copy user ID">
      <Button
        type="button"
        onClick={handleCopy}
        className="flex max-w-full px-1 py-0 h-min items-center gap-2 font-mono text-xs text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer bg-transparent hover:bg-transparent"
        aria-label="Copy user ID"
        title={user.id}
      >
        <span className="truncate">{idLabel}</span>
        <Copy className="h-3 w-3" />
      </Button>
    </SimpleTooltip>
  );
}

function EmailStatusCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const isVerified = user.emailVerified === "verified";
  return (
    <div className="flex items-center gap-2 text-sm">
      {isVerified ? (
        <>
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="font-medium text-success">Verified</span>
        </>
      ) : (
        <>
          <XCircle className="h-4 w-4 text-amber-500" />
          <span className="font-medium text-amber-600">Unverified</span>
        </>
      )}
    </div>
  );
}

function AuthMethodsCell(props: { user: ExtendedServerUser }) {
  const { user } = props;
  const authLabels = user.authTypes.length > 0 ? user.authTypes : ["none"];

  return (
    <div className="flex flex-wrap gap-2">
      {authLabels.map((type) => {
        const label = type === "none" ? "None" : AUTH_TYPE_LABELS.get(type) ?? titleCase(type);
        return (
          <Badge key={type} variant="outline" className="bg-muted/60 text-xs text-muted-foreground">
            {label}
          </Badge>
        );
      })}
    </div>
  );
}

function DateMetaCell(props: { value: Date | string | null | undefined, emptyLabel: string }) {
  const { value, emptyLabel } = props;
  const meta = getDateMeta(value, emptyLabel);
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap" title={meta.tooltip}>
      {meta.label}
    </span>
  );
}

function getDateMeta(value: Date | string | null | undefined, emptyLabel: string) {
  if (!value) {
    return { label: emptyLabel };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { label: emptyLabel };
  }
  return {
    label: fromNow(date),
    tooltip: date.toString(),
  };
}
