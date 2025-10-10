'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerTeam, ServerUser } from '@stackframe/stack';
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, DataTableI18n, SearchToolbarItem, SimpleTooltip } from "@stackframe/stack-ui";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { SmartFormDialog } from "../form-dialog";
import { PermissionListField } from "../permission-field";
import { ExtendedServerUser, extendUsers, getCommonUserColumns } from "./user-table";


type ExtendedServerUserForTeam = ExtendedServerUser & {
  permissions: string[],
};

function teamMemberToolbarRender<TData>(table: Table<TData>, searchPlaceholder: string) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder={searchPlaceholder} />
    </>
  );
}

function RemoveUserDialog(props: {
  team: ServerTeam,
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const t = useTranslations('common.dataTable.dialogs.removeUser');
  return <ActionDialog
    title
    danger
    open={props.open}
    onOpenChange={props.onOpenChange}
    okButton={{
      label: t('buttonLabel'),
      onClick: async () => { await props.team.removeUser(props.user.id); }
    }}
    cancelButton
    confirmText={t('confirmText')}
  >
    {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
    {t('description', { userName: props.user.displayName ?? props.user.primaryEmail ?? props.user.id, teamName: props.team.displayName ?? props.team.id })}
  </ActionDialog>;
}

function EditPermissionDialog(props: {
  user: ExtendedServerUserForTeam,
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onSubmit: () => void,
}) {
  const t = useTranslations('common.dataTable.dialogs.editPermission');
  const stackAdminApp = useAdminApp();
  const permissions = stackAdminApp.useTeamPermissionDefinitions();

  const formSchema = yup.object({
    permissions: yup.array().of(yup.string().defined()).defined().meta({
      stackFormFieldRender: (innerProps) => (
        <PermissionListField
          {...innerProps}
          permissions={permissions}
          type="edit-user"
          containedPermissionIds={props.user.permissions}
        />
      ),
    }),
  }).default({ permissions: props.user.permissions });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    formSchema={formSchema}
    okButton={{ label: t('save') }}
    onSubmit={async (values) => {
      const promises = permissions.map(p => {
        if (values.permissions.includes(p.id)) {
          return props.user.grantPermission(props.team, p.id);
        } else if (props.user.permissions.includes(p.id)) {
          return props.user.revokePermission(props.team, p.id);
        }
      });
      await Promise.all(promises);
      props.onSubmit();
    }}
    cancelButton
  />;
}


function Actions(
  { row, team, setUpdateCounter }:
  { row: Row<ExtendedServerUserForTeam>, team: ServerTeam, setUpdateCounter: (c: (v: number) => number) => void }
) {
  const t = useTranslations('common.dataTable.actions');
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  return (
    <>
      <RemoveUserDialog
        user={row.original}
        team={team}
        open={isRemoveModalOpen}
        onOpenChange={setIsRemoveModalOpen}
      />
      <EditPermissionDialog
        user={row.original}
        team={team}
        open={isEditModalOpen}
        onOpenChange={(v) => setIsEditModalOpen(v)}
        onSubmit={() => setUpdateCounter(c => c + 1)}
      />
      <ActionCell
        items={[
          {
            item: t('editPermissions'),
            onClick: () => setIsEditModalOpen(true),
          },
          '-',
          {
            item: t('removeFromTeam'),
            danger: true,
            onClick: () => setIsRemoveModalOpen(true),
          }
        ]}
      />
    </>
  );
}

export function TeamMemberTable(props: { users: ServerUser[], team: ServerTeam }) {
  const t = useTranslations('common.dataTable.columns');
  const tStatus = useTranslations('common.dataTable.status');
  const tSearch = useTranslations('common.dataTable');
  const tTooltips = useTranslations('common.dataTable.tooltips');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');

  const teamMemberColumns: ColumnDef<ExtendedServerUserForTeam>[] = [
    ...getCommonUserColumns<ExtendedServerUserForTeam>(t, tStatus),
    {
      accessorKey: "permissions",
      header: ({ column }) => <DataTableColumnHeader
        column={column}
        columnTitle={<div className="flex items-center gap-1">
          {t('permissions')}
          <SimpleTooltip tooltip={tTooltips('onlyShowingDirectPermissions')} type='info' />
        </div>}
      />,
      cell: ({ row }) => <BadgeCell size={120} badges={row.getValue("permissions")} />,
      enableSorting: false,
    },
    {
      id: "actions",
      cell: ({ row }) => <Actions row={row} team={props.team} setUpdateCounter={setUpdateCounter} />,
    },
  ];

  // TODO: Optimize this
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [userPermissions, setUserPermissions] = useState<Map<string, string[]>>(new Map());
  const [updateCounter, setUpdateCounter] = useState(0);

  const extendedUsers: ExtendedServerUserForTeam[] = useMemo(() => {
    return extendUsers(users).map((user) => ({
      ...user,
      permissions: userPermissions.get(user.id) ?? [],
    }));
  }, [users, userPermissions]);

  useEffect(() => {
    async function load() {
      const promises = props.users.map(async user => {
        const permissions = await user.listPermissions(props.team, { recursive: false });
        return {
          user,
          permissions,
        };
      });
      return await Promise.all(promises);
    }

    runAsynchronously(load().then((data) => {
      setUserPermissions(new Map(
        props.users.map((user, index) => [user.id, data[index].permissions.map(p => p.id)])
      ));
      setUsers(data.map(d => d.user));
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.users, props.team, updateCounter]);

  return <DataTable
    data={extendedUsers}
    columns={teamMemberColumns}
    toolbarRender={(table) => teamMemberToolbarRender(table, tSearch('search'))}
    defaultVisibility={{ emailVerified: false }}
    defaultColumnFilters={[]}
    defaultSorting={[]}
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
