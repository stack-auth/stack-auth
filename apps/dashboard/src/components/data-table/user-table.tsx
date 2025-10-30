"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import type { StackAdminApp } from "@stackframe/stack";
import { ServerUser } from "@stackframe/stack";
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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  MoreHorizontal,
  Search,
  X,
  XCircle,
  Copy,
} from "lucide-react";
import { usePathname, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  type MutableRefObject,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { z } from "zod";
import { Link } from "../link";
import { CreateCheckoutDialog } from "../payments/create-checkout-dialog";
import { DeleteUserDialog, ImpersonateUserDialog } from "../user-dialogs";

export type ExtendedServerUser = ServerUser & {
  authTypes: string[],
  emailVerified: "verified" | "unverified",
};

type QueryState = {
  search?: string,
  includeAnonymous: boolean,
  page: number,
  pageSize: number,
  cursor?: string,
};

type QueryUpdater =
  | Partial<QueryState>
  | ((prev: QueryState) => Partial<QueryState>);

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const SEARCH_DEBOUNCE_MS = 250;
const AUTH_TYPE_LABELS = new Map<string, string>([
  ["anonymous", "Anonymous"],
  ["otp", "Authenticator"],
  ["password", "Password"],
]);
const RELATIVE_TIME_DIVISIONS: { amount: number, unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
];

const querySchema = z.object({
  search: z
    .string()
    .transform((value) => (value.trim().length === 0 ? undefined : value.trim()))
    .optional(),
  includeAnonymous: z.literal("true").transform(() => true).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  cursor: z
    .string()
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
});

const columnHelper = createColumnHelper<ExtendedServerUser>();

export function UserTable() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const { state: query, setQuery } = useUserTableQueryState();
  const [searchInput, setSearchInput] = useState(query.search ?? "");
  const cursorCacheRef = useRef(new Map<number, string | null>([[1, null]]));
  const prefetchedCursorRef = useRef(new Set<string>());

  useEffect(() => {
    setSearchInput(query.search ?? "");
  }, [query.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const normalized = trimmed.length === 0 ? undefined : trimmed;
    if (normalized === (query.search ?? undefined)) {
      return;
    }
    const handle = window.setTimeout(() => {
      setQuery((prev) => ({
        ...prev,
        page: 1,
        cursor: undefined,
        search: normalized,
      }));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput, query.search, setQuery]);

  useEffect(() => {
    cursorCacheRef.current = new Map<number, string | null>([[1, null]]);
    prefetchedCursorRef.current.clear();
  }, [query.search, query.includeAnonymous, query.pageSize]);

  useEffect(() => {
    if (query.page > 1 && !query.cursor) {
      setQuery((prev) => ({ ...prev, page: 1, cursor: undefined }));
    }
  }, [query.page, query.cursor, setQuery]);

  const includeAnonymousChecked = query.includeAnonymous;

  return (
    <section className="space-y-4">
      <UserTableHeader
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        includeAnonymous={includeAnonymousChecked}
        onIncludeAnonymousChange={(value) =>
          setQuery((prev) => ({ ...prev, includeAnonymous: value, page: 1, cursor: undefined }))
        }
      />
      <div className="rounded-xl overflow-clip border border-slate-200 bg-white shadow-sm">
        <Suspense fallback={<UserTableSkeleton pageSize={query.pageSize} />}>
          <UserTableBody
            stackAdminApp={stackAdminApp}
            router={router}
            query={query}
            setQuery={setQuery}
            cursorCacheRef={cursorCacheRef}
            prefetchedCursorRef={prefetchedCursorRef}
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          {searchValue.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
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
  router: ReturnType<typeof useRouter>,
  query: QueryState,
  setQuery: (updater: QueryUpdater) => void,
  cursorCacheRef: MutableRefObject<Map<number, string | null>>,
  prefetchedCursorRef: MutableRefObject<Set<string>>,
}) {
  const { stackAdminApp, router, query, setQuery, cursorCacheRef, prefetchedCursorRef } = props;

  const baseOptions = useMemo(
    () => ({
      limit: query.pageSize,
      orderBy: "signedUpAt" as const,
      desc: true,
      query: query.search,
      includeAnonymous: query.includeAnonymous,
    }),
    [query.pageSize, query.search, query.includeAnonymous],
  );

  const storedCursor = cursorCacheRef.current.get(query.page);
  const cursorToUse = useMemo(() => {
    if (query.page === 1) {
      cursorCacheRef.current.set(1, null);
      return undefined;
    }
    if (storedCursor && storedCursor.length > 0) {
      return storedCursor;
    }
    if (storedCursor === null) {
      return undefined;
    }
    if (query.cursor) {
      cursorCacheRef.current.set(query.page, query.cursor);
      return query.cursor;
    }
    return undefined;
  }, [query.page, query.cursor, storedCursor, cursorCacheRef]);

  const listOptions = useMemo(
    () => ({
      ...baseOptions,
      cursor: cursorToUse,
    }),
    [baseOptions, cursorToUse],
  );

  const rawUsers = stackAdminApp.useUsers(listOptions);
  const stableRawUsers = useStableUsersReference(rawUsers);
  const users = useMemo(() => extendUsers(stableRawUsers), [stableRawUsers]);

  useEffect(() => {
    cursorCacheRef.current.set(query.page, query.page === 1 ? null : cursorToUse ?? null);
    if (users.nextCursor) {
      cursorCacheRef.current.set(query.page + 1, users.nextCursor);
    } else {
      cursorCacheRef.current.delete(query.page + 1);
    }
  }, [query.page, cursorToUse, users.nextCursor, cursorCacheRef]);

  useEffect(() => {
    if (!users.nextCursor) {
      return;
    }
    if (prefetchedCursorRef.current.has(users.nextCursor)) {
      return;
    }
    prefetchedCursorRef.current.add(users.nextCursor);
    runAsynchronously(
      stackAdminApp.listUsers({
        ...baseOptions,
        cursor: users.nextCursor,
      }),
    );
  }, [users.nextCursor, stackAdminApp, baseOptions, prefetchedCursorRef]);

  const columns = useMemo<ColumnDef<ExtendedServerUser>[]>(
    () => createUserColumns(stackAdminApp.projectId),
    [stackAdminApp.projectId],
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
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm text-slate-700">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-slate-200">
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 font-medium">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {hasResults ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 transition hover:bg-slate-50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-4 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={table.getAllColumns().length} className="px-6 py-12 text-center text-sm text-slate-500">
                  <div className="mx-auto flex max-w-md flex-col items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                      <Search className="h-6 w-6 text-slate-400" />
                    </div>
                    <div className="text-base font-medium text-slate-700">No users found</div>
                    <p className="text-sm text-slate-500">
                      Try adjusting your search or filters. You can also reset everything and start again.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        cursorCacheRef.current = new Map<number, string | null>([[1, null]]);
                        prefetchedCursorRef.current.clear();
                        setQuery({ search: undefined, includeAnonymous: false, page: 1, cursor: undefined });
                      }}
                    >
                      Reset filters
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Rows per page</span>
          <Select
            value={String(query.pageSize)}
            onValueChange={(value) =>
              setQuery((prev) => ({ ...prev, pageSize: Number(value), page: 1, cursor: undefined }))
            }
          >
            <SelectTrigger className="w-20" aria-label={`Rows per page: ${query.pageSize}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!hasPreviousPage) {
                return;
              }
              const previousPage = query.page - 1;
              const previousCursor = cursorCacheRef.current.get(previousPage);
              setQuery({ page: previousPage, cursor: previousPage === 1 ? undefined : previousCursor ?? undefined });
            }}
            disabled={!hasPreviousPage}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
            Page {query.page}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!hasNextPage) {
                return;
              }
              setQuery({ page: query.page + 1, cursor: users.nextCursor ?? undefined });
            }}
            disabled={!hasNextPage}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserTableSkeleton(props: { pageSize: number }) {
  const { pageSize } = props;
  const rows = Array.from({ length: pageSize });

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold tracking-wide text-slate-400">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">User ID</th>
              <th className="px-4 py-3">Email status</th>
              <th className="px-4 py-3">Last active</th>
              <th className="px-4 py-3">Auth methods</th>
              <th className="px-4 py-3">Signed up</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((_, index) => (
              <tr key={index} className="border-b border-slate-100">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-40" />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <Skeleton className="h-3 w-40" />
                </td>
                <td className="px-4 py-4">
                  <Skeleton className="h-3 w-24" />
                </td>
                <td className="px-4 py-4">
                  <Skeleton className="h-3 w-24" />
                </td>
                <td className="px-4 py-4">
                  <Skeleton className="h-3 w-20" />
                </td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                </td>
                <td className="px-4 py-4">
                  <Skeleton className="h-3 w-24" />
                </td>
                <td className="px-4 py-4 text-right">
                  <Skeleton className="ml-auto w-4 h-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Rows per page</span>
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500">
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

function createUserColumns(projectId: string): ColumnDef<ExtendedServerUser>[] {
  return [
    columnHelper.display({
      id: "user",
      header: () => <span className="text-xs font-semibold tracking-wide">User</span>,
      cell: ({ row }) => <UserIdentityCell user={row.original} projectId={projectId} />,
    }),
    columnHelper.display({
      id: "email",
      header: () => <span className="text-xs font-semibold tracking-wide">Email</span>,
      cell: ({ row }) => <UserEmailCell user={row.original} />,
    }),
    columnHelper.display({
      id: "userId",
      header: () => <span className="text-xs font-semibold tracking-wide">User ID</span>,
      cell: ({ row }) => <UserIdCell user={row.original} />,
    }),
    columnHelper.display({
      id: "emailStatus",
      header: () => <span className="text-xs font-semibold tracking-wide">Email status</span>,
      cell: ({ row }) => <EmailStatusCell user={row.original} />,
    }),
    columnHelper.accessor("lastActiveAt", {
      header: () => <span className="text-xs font-semibold tracking-wide">Last active</span>,
      cell: ({ row }) => <DateMetaCell value={row.original.lastActiveAt} emptyLabel="Never" />,
    }),
    columnHelper.display({
      id: "auth",
      header: () => <span className="text-xs font-semibold tracking-wide">Auth methods</span>,
      cell: ({ row }) => <AuthMethodsCell user={row.original} />,
    }),
    columnHelper.accessor("signedUpAt", {
      header: () => <span className="text-xs font-semibold tracking-wide">Signed up</span>,
      cell: ({ row }) => <DateMetaCell value={row.original.signedUpAt} emptyLabel="Unknown" />,
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <UserActions user={row.original} projectId={projectId} />,
    }),
  ];
}

function UserIdentityCell(props: { user: ExtendedServerUser, projectId: string }) {
  const { user, projectId } = props;
  const profileUrl = `/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user.id)}`;
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
            className="max-w-[240px] truncate text-sm font-semibold text-slate-900 hover:text-slate-700"
            title={displayName}
          >
            {displayName}
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
    <span className="block max-w-[240px] truncate text-sm text-slate-600" title={user.primaryEmail ?? undefined}>
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
        className="flex max-w-[180px] items-center gap-2 truncate rounded px-1 py-0.5 font-mono text-xs text-slate-500 transition hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer bg-transparent hover:bg-transparent"
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
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="font-medium text-emerald-600">Verified</span>
        </>
      ) : (
        <>
          <SimpleTooltip tooltip="Email is not verified" type="warning">
            <XCircle className="h-4 w-4 text-amber-500" />
          </SimpleTooltip>
          <span className="font-medium text-amber-600">Pending</span>
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
          <Badge key={type} variant="outline" className="bg-slate-50 text-xs text-slate-700">
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
    <span className="text-sm text-slate-600 whitespace-nowrap" title={meta.tooltip}>
      {meta.label}
    </span>
  );
}

function UserActions(props: { user: ExtendedServerUser, projectId: string }) {
  const { user, projectId } = props;
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
              router.push(`/projects/${encodeURIComponent(projectId)}/users/${encodeURIComponent(user.id)}`)
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
                    document.cookie = 'stack-refresh-${projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/';
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
          <DropdownMenuItem onClick={() => setIsDeleteOpen(true)} className="text-rose-600 focus:text-rose-600">
            Delete user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function extendUsers(users: ServerUser[] & { nextCursor: string | null }): ExtendedServerUser[] & { nextCursor: string | null };
function extendUsers(users: ServerUser[]): ExtendedServerUser[];
function extendUsers(users: ServerUser[] & { nextCursor?: string | null }) {
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

function useStableUsersReference(users: ServerUser[] & { nextCursor: string | null }) {
  const previousRef = useRef<{ fingerprint: string, value: ServerUser[] & { nextCursor: string | null } }>();
  const fingerprint = useMemo(() => getUsersFingerprint(users), [users]);

  if (previousRef.current && previousRef.current.fingerprint === fingerprint) {
    return previousRef.current.value;
  }

  previousRef.current = { fingerprint, value: users };
  return users;
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

function parseQuery(params: ReadonlyURLSearchParams): QueryState {
  const raw: Record<string, string> = {};
  params.forEach((value, key) => {
    raw[key] = value;
  });
  const result = querySchema.safeParse(raw);
  if (!result.success) {
    return {
      includeAnonymous: false,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    };
  }
  return sanitizeQueryState(result.data);
}

function sanitizeQueryState(state: Partial<QueryState>): QueryState {
  const search = state.search?.trim() ? state.search.trim() : undefined;
  const includeAnonymous = Boolean(state.includeAnonymous);
  const candidatePageSize = state.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = PAGE_SIZE_OPTIONS.includes(candidatePageSize) ? candidatePageSize : DEFAULT_PAGE_SIZE;
  const candidatePage = state.page ?? 1;
  const page = Number.isFinite(candidatePage) ? Math.max(1, Math.floor(candidatePage)) : 1;
  const cursor = page > 1 && state.cursor ? state.cursor : undefined;
  return { search, includeAnonymous, page, pageSize, cursor };
}

function isQueryEqual(a: QueryState, b: QueryState) {
  return (
    a.search === b.search &&
    a.includeAnonymous === b.includeAnonymous &&
    a.page === b.page &&
    a.pageSize === b.pageSize &&
    a.cursor === b.cursor
  );
}

function useUserTableQueryState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const state = useMemo(() => parseQuery(searchParams), [searchParams]);

  const setQuery = useCallback(
    (updater: QueryUpdater) => {
      const current = parseQuery(searchParams);
      const patch = typeof updater === "function" ? updater(current) : updater;
      const next = sanitizeQueryState({ ...current, ...patch });
      if (isQueryEqual(current, next)) {
        return;
      }
      const params = new URLSearchParams();
      if (next.search) {
        params.set("search", next.search);
      }
      if (next.includeAnonymous) {
        params.set("includeAnonymous", "true");
      }
      if (next.page > 1) {
        params.set("page", String(next.page));
      }
      if (next.pageSize !== DEFAULT_PAGE_SIZE) {
        params.set("pageSize", String(next.pageSize));
      }
      if (next.cursor) {
        params.set("cursor", next.cursor);
      }
      const queryString = params.toString();
      startTransition(() => {
        router.replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname, { scroll: false });
      });
    },
    [router, pathname, searchParams, startTransition],
  );

  return { state, setQuery };
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

function getDateMeta(value: Date | string | null | undefined, emptyLabel: string) {
  if (!value) {
    return { label: emptyLabel };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { label: emptyLabel };
  }
  return {
    label: formatRelativeTime(date),
    tooltip: formatAbsoluteTime(date),
  };
}

function formatRelativeTime(date: Date) {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let duration = Math.round((date.getTime() - Date.now()) / 1000);
  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(duration, division.unit);
    }
    duration = Math.round(duration / division.amount);
  }
  return formatter.format(duration, "year");
}

function formatAbsoluteTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
