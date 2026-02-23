'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { Avatar, AvatarFallback, AvatarImage, Button, Input, Skeleton } from "@/components/ui";
import { MagnifyingGlassIcon, XIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { ServerUser } from '@stackframe/stack';
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useCursorPaginationCache } from "./common/cursor-pagination";
import { PaginationControls } from "./common/pagination";
import { useStableValue } from "./common/stable-value";
import { TableContent, type ColumnLayout, type ColumnMeta } from "./common/table";
import { TableSkeleton } from "./common/table-skeleton";
import { extendUsers } from "./user-table";

const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_PAGE_SIZE = 10;

type QueryState = {
  search?: string,
  page: number,
  pageSize: number,
  cursor?: string,
};

type ColumnKey = "avatar" | "displayName" | "primaryEmail" | "actions";

const COLUMN_LAYOUT: ColumnLayout<ColumnKey> = {
  avatar: { size: 50, minWidth: 50, maxWidth: 50, width: "50px" },
  displayName: { size: 150, minWidth: 100, maxWidth: 200, width: "clamp(100px, 20vw, 200px)" },
  primaryEmail: { size: 200, minWidth: 150, maxWidth: 250, width: "clamp(150px, 25vw, 250px)" },
  actions: { size: 100, minWidth: 80, maxWidth: 120, width: "clamp(80px, 15vw, 120px)", headerClassName: "text-right", cellClassName: "text-right" },
};


export function TeamMemberSearchTable(props: {
  action: (user: ServerUser) => React.ReactNode,
}) {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState<QueryState>({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const cursorPaginationCache = useCursorPaginationCache();

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
  }, [searchInput, query.search]);

  useEffect(() => {
    cursorPaginationCache.resetCache();
  }, [cursorPaginationCache, query.search, query.pageSize]);

  return (
    <div className="space-y-2">
      <TeamMemberSearchHeader
        searchValue={searchInput}
        onSearchChange={setSearchInput}
      />
      <div className="overflow-clip rounded-md border border-border bg-card">
        <Suspense fallback={<TeamMemberTableSkeleton pageSize={query.pageSize} />}>
          <TeamMemberSearchBody
            query={query}
            setQuery={setQuery}
            cursorPaginationCache={cursorPaginationCache}
            action={props.action}
          />
        </Suspense>
      </div>
    </div>
  );
}

function TeamMemberSearchHeader(props: {
  searchValue: string,
  onSearchChange: (value: string) => void,
}) {
  const { searchValue, onSearchChange } = props;

  return (
    <div className="relative w-full">
      <Input
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search users..."
        className="!pl-8 !pr-8 h-8"
        autoComplete="off"
      />
      <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      {searchValue.length > 0 && (
        <button
          type="button"
          onClick={() => onSearchChange("")}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          aria-label="Clear search"
        >
          <XIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function getUsersFingerprint(users: ServerUser[] & { nextCursor: string | null }) {
  const ids = users.map(u => u.id).join(",");
  return `${ids}|${users.nextCursor ?? "null"}`;
}

function TeamMemberSearchBody(props: {
  query: QueryState,
  setQuery: React.Dispatch<React.SetStateAction<QueryState>>,
  cursorPaginationCache: ReturnType<typeof useCursorPaginationCache>,
  action: (user: ServerUser) => React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const { query, setQuery } = props;
  const {
    readCursorForPage,
    recordPageCursor,
    recordNextCursor,
  } = props.cursorPaginationCache;

  // Use ref for action to avoid invalidating columns memoization
  const actionRef = useRef(props.action);
  actionRef.current = props.action;

  const storedCursor = readCursorForPage(query.page);
  const cursorToUse = useMemo(() => {
    if (query.page === 1) {
      return undefined;
    }
    if (storedCursor && storedCursor.length > 0) {
      return storedCursor;
    }
    return storedCursor === null ? undefined : query.cursor;
  }, [query.page, query.cursor, storedCursor]);

  const listOptions = useMemo(
    () => ({
      limit: query.pageSize,
      query: query.search,
      cursor: cursorToUse,
    }),
    [query.pageSize, query.search, cursorToUse],
  );

  // Stabilize the users data to prevent unnecessary re-renders
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

  // Columns are memoized with empty deps since action is accessed via ref
  const columns = useMemo((): ColumnDef<ServerUser>[] => [
    {
      id: "avatar",
      accessorKey: "profileImageUrl",
      header: () => null,
      cell: ({ row }) => (
        <Avatar className="h-8 w-8">
          <AvatarImage src={row.original.profileImageUrl ?? undefined} />
          <AvatarFallback className="text-xs">
            {row.original.displayName?.charAt(0) ?? row.original.primaryEmail?.charAt(0) ?? "?"}
          </AvatarFallback>
        </Avatar>
      ),
      meta: { columnKey: "avatar" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: "displayName",
      accessorKey: "displayName",
      header: () => <span className="text-xs font-medium">Display Name</span>,
      cell: ({ row }) => (
        <span className={row.original.displayName === null ? 'text-muted-foreground' : ''}>
          {row.original.displayName ?? '–'}
        </span>
      ),
      meta: { columnKey: "displayName" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: "primaryEmail",
      accessorKey: "primaryEmail",
      header: () => <span className="text-xs font-medium">Email</span>,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate">
          {row.original.primaryEmail ?? '–'}
        </span>
      ),
      meta: { columnKey: "primaryEmail" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: "actions",
      header: () => null,
      cell: ({ row }) => actionRef.current(row.original),
      meta: { columnKey: "actions" } satisfies ColumnMeta<ColumnKey>,
    },
  ], []);

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const hasNextPage = users.nextCursor !== null;
  const hasPreviousPage = query.page > 1;

  return (
    <div className="flex flex-col">
      <TableContent
        table={table}
        columnLayout={COLUMN_LAYOUT}
        renderEmptyState={() => (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No users found</p>
          </div>
        )}
        rowHeightPx={56}
      />
      <PaginationControls
        page={query.page}
        pageSize={query.pageSize}
        hasNextPage={hasNextPage}
        hasPreviousPage={hasPreviousPage}
        onPageSizeChange={(value) =>
          setQuery((prev) => ({ ...prev, pageSize: value, page: 1, cursor: undefined }))
        }
        onPreviousPage={() => {
          if (!hasPreviousPage) return;
          const previousPage = query.page - 1;
          const previousCursor = readCursorForPage(previousPage);
          setQuery((prev) => ({
            ...prev,
            page: previousPage,
            cursor: previousPage === 1 ? undefined : previousCursor ?? undefined,
          }));
        }}
        onNextPage={() => {
          if (!hasNextPage) return;
          setQuery((prev) => ({
            ...prev,
            page: query.page + 1,
            cursor: users.nextCursor ?? undefined,
          }));
        }}
        className="border-t border-border/70"
      />
    </div>
  );
}

function TeamMemberTableSkeleton(props: { pageSize: number }) {
  const columnOrder: ColumnKey[] = ["avatar", "displayName", "primaryEmail", "actions"];
  const skeletonHeaders: Record<ColumnKey, string | null> = {
    avatar: null,
    displayName: "Display Name",
    primaryEmail: "Email",
    actions: null,
  };

  const renderSkeletonCell = (columnKey: ColumnKey): JSX.Element => {
    switch (columnKey) {
      case "avatar": {
        return <Skeleton className="h-8 w-8 rounded-full" />;
      }
      case "displayName": {
        return <Skeleton className="h-3 w-24" />;
      }
      case "primaryEmail": {
        return <Skeleton className="h-3 w-32" />;
      }
      case "actions": {
        return <Skeleton className="h-8 w-16 ml-auto" />;
      }
      default: {
        return <Skeleton className="h-3 w-20" />;
      }
    }
  };

  return (
    <div className="flex flex-col">
      <TableSkeleton
        columnOrder={columnOrder}
        columnLayout={COLUMN_LAYOUT}
        headerLabels={skeletonHeaders}
        rowCount={props.pageSize}
        renderCellSkeleton={renderSkeletonCell}
        rowHeightPx={56}
      />
      <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Skeleton className="h-8 w-16" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled>
            <CaretLeftIcon className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span className="rounded-md border border-border px-3 py-1 text-xs font-medium">
            Page …
          </span>
          <Button variant="ghost" size="sm" disabled>
            Next
            <CaretRightIcon className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
