'use client';
import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { useRouter } from "@/components/router";
import { ServerUser } from '@stackframe/stack';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { ActionCell, AvatarCell, BadgeCell, DataTableColumnHeader, DataTableI18n, DataTableManualPagination, DateCell, SearchToolbarItem, SimpleTooltip, TextCell } from "@stackframe/stack-ui";
import { ColumnDef, ColumnFiltersState, Row, SortingState, Table } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import React, { useState } from "react";
import { Link } from '../link';
import { CreateCheckoutDialog } from '../payments/create-checkout-dialog';
import { DeleteUserDialog, ImpersonateUserDialog } from '../user-dialogs';

export type ExtendedServerUser = ServerUser & {
  authTypes: string[],
  emailVerified: 'verified' | 'unverified',
};

function userToolbarRender<TData>(table: Table<TData>, showAnonymous: boolean, setShowAnonymous: (value: boolean) => void, t: any, tUsers: any) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder={t('search')} />
      <div className="flex items-center gap-2 ml-auto mr-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showAnonymous}
            onChange={(e) => setShowAnonymous(e.target.checked)}
            className="rounded border-gray-300"
          />
          {tUsers('showAnonymous')}
        </label>
      </div>
    </>
  );
}

function UserActions({ row }: { row: Row<ExtendedServerUser> }) {
  const t = useTranslations('common.dataTable.actions');
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
            item: t('viewDetails'),
            onClick: () => {
              router.push(`/projects/${encodeURIComponent(app.projectId)}/users/${encodeURIComponent(row.original.id)}`);
            },
          },
          {
            item: t('impersonate'),
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
            item: t('createCheckout'),
            onClick: () => setIsCreateCheckoutModalOpen(true),
          },
          ...row.original.isMultiFactorRequired ? [{
            item: t('remove2FA'),
            onClick: async () => {
              await row.original.update({ totpMultiFactorSecret: null });
            },
          }] : [],
          '-',
          {
            item: t('delete'),
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

export const getCommonUserColumns = <T extends ExtendedServerUser>(t: any, tStatus: any) => [
  {
    accessorKey: "profileImageUrl",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('avatar')} />,
    cell: ({ row }) => {
      return <AvatarCellWrapper user={row.original} />;
    },
    enableSorting: false,
  },
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('id')} />,
    cell: ({ row }) => <TextCell size={60}>{row.original.id}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('displayName')} />,
    cell: ({ row }) =>  <TextCell size={120}>
      <div className="flex items-center gap-2">
        <span className={row.original.displayName === null ? 'text-slate-400' : ''}>{row.original.displayName ?? '–'}</span>
        {row.original.isAnonymous && <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">{tStatus('anonymous')}</span>}
      </div>
    </TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "primaryEmail",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('primaryEmail')} />,
    cell: ({ row }) => <TextCell
      size={180}
      icon={row.original.primaryEmail && row.original.emailVerified === "unverified" && <SimpleTooltip tooltip={tStatus('emailNotVerified')} type='warning'/>}>
      {row.original.primaryEmail ?? '–'}
    </TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "lastActiveAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('lastActive')} />,
    cell: ({ row }) => <DateCell date={row.original.lastActiveAt} />,
    enableSorting: false,
  },
  {
    accessorKey: "emailVerified",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('emailVerified')} />,
    cell: ({ row }) => <TextCell>{row.original.emailVerified === 'verified' ? tStatus('verified') : tStatus('unverified')}</TextCell>,
    enableSorting: false,
  },
] satisfies ColumnDef<T>[];

const getColumns = (t: any, tStatus: any): ColumnDef<ExtendedServerUser>[] => [
  ...getCommonUserColumns<ExtendedServerUser>(t, tStatus),
  {
    accessorKey: "authTypes",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('authMethod')} />,
    cell: ({ row }) => <BadgeCell badges={row.original.authTypes} />,
    enableSorting: false,
  },
  {
    accessorKey: "signedUpAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('signedUpAt')} />,
    cell: ({ row }) => <DateCell date={row.original.signedUpAt} />,
  },
  {
    id: "actions",
    cell: ({ row }) => <UserActions row={row} />,
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

export function UserTable() {
  const t = useTranslations('common.dataTable.columns');
  const tStatus = useTranslations('common.dataTable.status');
  const tSearch = useTranslations('common.dataTable');
  const tUsers = useTranslations('users.table');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [showAnonymous, setShowAnonymous] = useState(false);
  const [filters, setFilters] = useState<Parameters<typeof stackAdminApp.listUsers>[0]>({
    limit: 10,
    orderBy: "signedUpAt",
    desc: true,
    includeAnonymous: false,
  });

  const columns = React.useMemo(() => getColumns(t, tStatus), [t, tStatus]);

  // Update filters when showAnonymous changes
  React.useEffect(() => {
    setFilters(prev => ({ ...prev, includeAnonymous: showAnonymous }));
  }, [showAnonymous]);

  const users = extendUsers(stackAdminApp.useUsers(filters));

  const onUpdate = async (options: {
    cursor: string,
    limit: number,
    sorting: SortingState,
    columnFilters: ColumnFiltersState,
    globalFilters: any,
  }) => {
    let newFilters: Parameters<typeof stackAdminApp.listUsers>[0] = {
      cursor: options.cursor,
      limit: options.limit,
      query: options.globalFilters,
    };

    const orderMap = {
      signedUpAt: "signedUpAt",
    } as const;
    if (options.sorting.length > 0 && options.sorting[0].id in orderMap) {
      newFilters.orderBy = orderMap[options.sorting[0].id as keyof typeof orderMap];
      newFilters.desc = options.sorting[0].desc;
    }

    if (deepPlainEquals(newFilters, filters, { ignoreUndefinedValues: true })) {
      // save ourselves a request if the filters didn't change
      return { nextCursor: users.nextCursor };
    } else {
      setFilters(newFilters);
      const users = await stackAdminApp.listUsers(newFilters);
      return { nextCursor: users.nextCursor };
    }
  };

  return <DataTableManualPagination
    columns={columns}
    data={users}
    toolbarRender={(table) => userToolbarRender(table, showAnonymous, setShowAnonymous, tSearch, tUsers)}
    onUpdate={onUpdate}
    defaultVisibility={{ emailVerified: false }}
    defaultColumnFilters={[]}
    defaultSorting={[{ id: 'signedUpAt', desc: true }]}
    onRowClick={(row) => {
      router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(row.id)}`);
    }}
    i18n={{
      resetFilters: tToolbar('resetFilters'),
      exportCSV: tToolbar('exportCSV'),
      noDataToExport: tToolbar('noDataToExport'),
      view: tToolbar('view'),
      toggleColumns: tToolbar('toggleColumns'),
      rowsSelected: (selected: number, total: number) => tPagination('rowsSelected', { selected, total }),
      rowsPerPage: tPagination('rowsPerPage'),
      previousPage: tPagination('goToPreviousPage'),
      nextPage: tPagination('goToNextPage'),
    } satisfies DataTableI18n}
  />;
}
