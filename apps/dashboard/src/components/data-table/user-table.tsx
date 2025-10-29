'use client';
import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { useRouter } from "@/components/router";
import { ServerUser } from '@stackframe/stack';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { ActionCell, AvatarCell, BadgeCell, DataTableColumnHeader, DataTableManualPagination, DateCell, SearchToolbarItem, SimpleTooltip, Skeleton, TextCell } from "@stackframe/stack-ui";
import { ColumnDef, ColumnFiltersState, Row, SortingState, Table as TableType } from "@tanstack/react-table";
import { useEffect, useCallback, useRef, useState } from "react";
import { Link } from '../link';
import { CreateCheckoutDialog } from '../payments/create-checkout-dialog';
import { DeleteUserDialog, ImpersonateUserDialog } from '../user-dialogs';

export type ExtendedServerUser = ServerUser & {
  authTypes: string[],
  emailVerified: 'verified' | 'unverified',
};

function userToolbarRender<TData>(
  table: TableType<TData>,
  showAnonymous: boolean,
  onIncludeAnonymousChange: (value: boolean, table: TableType<TData>) => void,
) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder="Search table" />
      <div className="flex items-center gap-2 ml-auto mr-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showAnonymous}
            onChange={(e) => onIncludeAnonymousChange(e.target.checked, table)}
            className="rounded border-gray-300"
          />
          Show anonymous users
        </label>
      </div>
    </>
  );
}

function UserActions({ row }: { row: Row<ExtendedServerUser> }) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(null);
  const [isCreateCheckoutModalOpen, setIsCreateCheckoutModalOpen] = useState(false);
  const app = useAdminApp();
  const router = useRouter();
  return (
    <>
      <DeleteUserDialog user={row.original} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} />
      <ImpersonateUserDialog user={row.original} impersonateSnippet={impersonateSnippet} onClose={() => setImpersonateSnippet(null)} />
      <CreateCheckoutDialog open={isCreateCheckoutModalOpen} onOpenChange={setIsCreateCheckoutModalOpen} user={row.original} />
      <ActionCell
        items={[
          {
            item: "View details",
            onClick: () => {
              router.push(`/projects/${encodeURIComponent(app.projectId)}/users/${encodeURIComponent(row.original.id)}`);
            },
          },
          {
            item: "Impersonate",
            onClick: async () => {
              const expiresInMillis = 1000 * 60 * 60 * 2;
              const expiresAtDate = new Date(Date.now() + expiresInMillis);
              const session = await row.original.createSession({ expiresInMillis, isImpersonation: true });
              const tokens = await session.getTokens();
              setImpersonateSnippet(deindent`
                document.cookie = 'stack-refresh-${app.projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/'; 
                window.location.reload();
              `);
            }
          },
          {
            item: "Create Checkout",
            onClick: () => setIsCreateCheckoutModalOpen(true),
          },
          ...row.original.isMultiFactorRequired ? [{
            item: "Remove 2FA",
            onClick: async () => {
              await row.original.update({ totpMultiFactorSecret: null });
            },
          }] : [],
          '-',
          {
            item: "Delete",
            onClick: () => setIsDeleteModalOpen(true),
            danger: true,
          },
        ]}
      />
    </>
  );
}

function AvatarCellWrapper({ user }: { user: ServerUser }) {
  const stackAdminApp = useAdminApp();
  return <Link href={`/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(user.id)}`}>
    <AvatarCell
      src={user.profileImageUrl ?? undefined}
      fallback={user.displayName?.charAt(0) ?? user.primaryEmail?.charAt(0) ?? '?'}
    />
  </Link>;
}

export const getCommonUserColumns = <T extends ExtendedServerUser>() => [
  {
    accessorKey: "profileImageUrl",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Avatar" />,
    cell: ({ row }) => {
      return <AvatarCellWrapper user={row.original} />;
    },
    enableSorting: false,
    meta: {
      loading: <Skeleton className="h-6 w-6 rounded-full" />,
    },
  },
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="ID" />,
    cell: ({ row }) => <TextCell size={60}>{row.original.id}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Display Name" />,
    cell: ({ row }) => <TextCell size={120}>
      <div className="flex items-center gap-2">
        <span className={row.original.displayName === null ? 'text-slate-400' : ''}>{row.original.displayName ?? '–'}</span>
        {row.original.isAnonymous && <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">Anonymous</span>}
      </div>
    </TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "primaryEmail",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Primary Email" />,
    cell: ({ row }) => <TextCell
      size={180}
      icon={row.original.primaryEmail && row.original.emailVerified === "unverified" && <SimpleTooltip tooltip='Email not verified' type='warning' />}>
      {row.original.primaryEmail ?? '–'}
    </TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "lastActiveAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Last Active" />,
    cell: ({ row }) => <DateCell date={row.original.lastActiveAt} />,
    enableSorting: false,
  },
  {
    accessorKey: "emailVerified",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Email Verified" />,
    cell: ({ row }) => <TextCell>{row.original.emailVerified === 'verified' ? '✓' : '✗'}</TextCell>,
    enableSorting: false,
  },
] satisfies ColumnDef<T>[];

const columns: ColumnDef<ExtendedServerUser>[] = [
  ...getCommonUserColumns<ExtendedServerUser>(),
  {
    accessorKey: "authTypes",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Auth Method" />,
    cell: ({ row }) => <BadgeCell badges={row.original.authTypes} />,
    enableSorting: false,
  },
  {
    accessorKey: "signedUpAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Signed Up At" />,
    cell: ({ row }) => <DateCell date={row.original.signedUpAt} />,
  },
  {
    id: "actions",
    cell: ({ row }) => <UserActions row={row} />,
    meta: {
      loading: <div className="p-1"><Skeleton className="h-6 w-6 rounded-md" /></div>
    },
  },
];

export function extendUsers(users: ServerUser[] & { nextCursor: string | null }): ExtendedServerUser[] & { nextCursor: string | null };
export function extendUsers(users: ServerUser[]): ExtendedServerUser[];
export function extendUsers(users: ServerUser[] & { nextCursor?: string | null }): ExtendedServerUser[] & { nextCursor: string | null | undefined } {
  const extended = users.map((user) => ({
    ...user,
    authTypes: user.isAnonymous ? ["anonymous"] : [
      ...user.otpAuthEnabled ? ["otp"] : [],
      ...user.hasPassword ? ["password"] : [],
      ...user.oauthProviders.map(p => p.id),
    ],
    emailVerified: user.primaryEmailVerified ? "verified" : "unverified",
  } satisfies ExtendedServerUser)).sort((a, b) => a.signedUpAt > b.signedUpAt ? -1 : 1);
  return Object.assign(extended, { nextCursor: users.nextCursor });
}

type ExtendedUsersResult = ReturnType<typeof extendUsers>;

export function UserTable() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [users, setUsers] = useState<ExtendedUsersResult>(() => {
    const empty = [] as ExtendedUsersResult;
    return empty;
  });
  const [includeAnonymous, setIncludeAnonymous] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const latestRequestIdRef = useRef(0);
  const loadingState = isFetching ? { isLoading: true, rowCount: 10 } : undefined;

  const onUpdate = useCallback(async ({
    cursor,
    limit,
    sorting,
    columnFilters: _columnFilters,
    globalFilters,
  }: {
    cursor: string,
    limit: number,
    sorting: SortingState,
    columnFilters: ColumnFiltersState,
    globalFilters: any,
  }) => {
    const primarySort = sorting[0];
    const nextFilters: Parameters<typeof stackAdminApp.listUsers>[0] = {
      cursor,
      limit,
      query: globalFilters,
      orderBy: "signedUpAt",
      desc: primarySort.id === "signedUpAt" ? primarySort.desc : true,
      includeAnonymous,
    };

    const requestId = ++latestRequestIdRef.current;
    setIsFetching(true);
    try {
      const freshUsers = extendUsers(await stackAdminApp.listUsers(nextFilters));
      if (requestId === latestRequestIdRef.current) {
        setUsers(freshUsers);
      }
      return { nextCursor: freshUsers.nextCursor ?? null };
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsFetching(false);
      }
    }
  }, [includeAnonymous, stackAdminApp]);

  const handleIncludeAnonymousChange = useCallback((value: boolean, table: TableType<ExtendedServerUser>) => {
    if (includeAnonymous === value) {
      return;
    }
    setIncludeAnonymous(value);
    table.setPageIndex(0);
  }, [includeAnonymous]);

  return <DataTableManualPagination
    columns={columns}
    data={users}
    toolbarRender={(table) => userToolbarRender(table, includeAnonymous, handleIncludeAnonymousChange)}
    onUpdate={onUpdate}
    defaultVisibility={{ emailVerified: false }}
    defaultColumnFilters={[]}
    defaultSorting={[{ id: 'signedUpAt', desc: true }]}
    onRowClick={(row) => {
      router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(row.id)}`);
    }}
    loadingState={loadingState}
    externalRefreshKey={String(includeAnonymous)}
  />;
}
