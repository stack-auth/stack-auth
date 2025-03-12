'use client';
import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { useRouter } from "@/components/router";
import { ServerUser } from '@stackframe/stack';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { ActionCell, ActionDialog, AvatarCell, BadgeCell, CopyField, DataTableColumnHeader, DataTableManualPagination, DateCell, SearchToolbarItem, SimpleTooltip, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef, ColumnFiltersState, Row, SortingState, Table } from "@tanstack/react-table";
import { useState } from "react";
import { Link } from '../link';
import { UserDialog } from '../user-dialog';

export type ExtendedServerUser = ServerUser & {
  authTypes: string[],
  emailVerified: 'verified' | 'unverified',
};

function userToolbarRender<TData>(table: Table<TData>) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder="Search table" />
    </>
  );
}

function DeleteUserDialog(props: {
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete User"
    danger
    cancelButton
    okButton={{ label: "Delete User", onClick: async () => { await props.user.delete(); } }}
    confirmText="I understand that this action cannot be undone."
  >
    {`Are you sure you want to delete the user ${props.user.displayName ? '"' + props.user.displayName + '"' : ''} with ID ${props.user.id}?`}
  </ActionDialog>;
}

function ImpersonateUserDialog(props: {
  user: ServerUser,
  impersonateSnippet: string | null,
  onClose: () => void,
}) {
  return <ActionDialog
    open={props.impersonateSnippet !== null}
    onOpenChange={(open) => !open && props.onClose()}
    title="Impersonate User"
    okButton
  >
    <Typography>
      Open your website and paste the following code into the browser console:
    </Typography>
    <CopyField
      monospace
      height={60}
      value={props.impersonateSnippet ?? ""}
    />
  </ActionDialog>;
}

function UserActions({ row }: { row: Row<ExtendedServerUser> }) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(null);
  const app = useAdminApp();
  const router = useRouter();
  return (
    <>
      <UserDialog user={row.original} type="edit" open={isEditModalOpen} onOpenChange={setIsEditModalOpen} />
      <DeleteUserDialog user={row.original} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} />
      <ImpersonateUserDialog user={row.original} impersonateSnippet={impersonateSnippet} onClose={() => setImpersonateSnippet(null)} />
      <ActionCell
        items={[
          {
            item: "View details",
            onClick: () => {
              router.push(`/projects/${encodeURIComponent(app.projectId)}/users/${encodeURIComponent(row.original.id)}`);
            },
          },
          {
            item: "Edit",
            onClick: () => setIsEditModalOpen(true),
          },
          '-',
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
    cell: ({ row }) =>  <TextCell size={120}><span className={row.original.displayName === null ? 'text-slate-400' : ''}>{row.original.displayName ?? '–'}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "primaryEmail",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Primary Email" />,
    cell: ({ row }) => <TextCell
      size={180}
      icon={row.original.primaryEmail && row.original.emailVerified === "unverified" && <SimpleTooltip tooltip='Email not verified' type='warning'/>}>
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
  },
];

export function extendUsers(users: ServerUser[] & { nextCursor: string | null }): ExtendedServerUser[] & { nextCursor: string | null };
export function extendUsers(users: ServerUser[]): ExtendedServerUser[];
export function extendUsers(users: ServerUser[] & { nextCursor?: string | null }): ExtendedServerUser[] & { nextCursor: string | null | undefined } {
  const extended = users.map((user) => ({
    ...user,
    authTypes: [
      ...user.otpAuthEnabled ? ["otp"] : [],
      ...user.hasPassword ? ["password"] : [],
      ...user.oauthProviders.map(p => p.id),
    ],
    emailVerified: user.primaryEmailVerified ? "verified" : "unverified",
  } satisfies ExtendedServerUser)).sort((a, b) => a.signedUpAt > b.signedUpAt ? -1 : 1);
  return Object.assign(extended, { nextCursor: users.nextCursor });
}

export function UserTable() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [filters, setFilters] = useState<Parameters<typeof stackAdminApp.listUsers>[0]>({ limit: 10, orderBy: "signedUpAt", desc: true });
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
    toolbarRender={userToolbarRender}
    onUpdate={onUpdate}
    defaultVisibility={{ emailVerified: false }}
    defaultColumnFilters={[]}
    defaultSorting={[{ id: 'signedUpAt', desc: true }]}
    onRowClick={(row) => {
      router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/users/${encodeURIComponent(row.id)}`);
    }}
  />;
}
