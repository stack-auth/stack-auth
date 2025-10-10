'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, DataTableI18n, SearchToolbarItem, SimpleTooltip, TextCell } from "@stackframe/stack-ui";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import { useMemo, useState } from "react";
import * as yup from "yup";
import { SmartFormDialog } from "../form-dialog";
import { PermissionListField } from "../permission-field";

type AdminPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};

type PermissionType = 'project' | 'team';

function toolbarRender<TData>(table: Table<TData>, searchPlaceholder: string) {
  return (
    <>
      <SearchToolbarItem table={table} keyName="id" placeholder={searchPlaceholder} />
    </>
  );
}

function EditDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  selectedPermissionId: string,
  permissionType: PermissionType,
}) {
  const t = useTranslations('permissions.table.dialogs.edit');
  const stackAdminApp = useAdminApp();
  const teamPermissions = stackAdminApp.useTeamPermissionDefinitions();
  const projectPermissions = stackAdminApp.useProjectPermissionDefinitions();
  const permissions = props.permissionType === 'project' ? projectPermissions : teamPermissions;
  const combinedPermissions = [...teamPermissions, ...projectPermissions];

  const currentPermission = permissions.find((p) => p.id === props.selectedPermissionId);
  if (!currentPermission) {
    return null;
  }

  const formSchema = yup.object({
    id: yup.string()
      .defined()
      .oneOf([props.selectedPermissionId])
      .matches(/^[a-z0-9_:]+$/, t('idValidation'))
      .label(t('idLabel'))
      .meta({
        stackFormFieldExtraProps: {
          disabled: true,
        },
      }),
    description: yup.string().label(t('descriptionLabel')),
    containedPermissionIds: yup.array().of(yup.string().defined()).defined().meta({
      stackFormFieldRender: (innerProps) => (
        <PermissionListField
          {...innerProps}
          permissions={permissions.map((p) => ({
            id: p.id,
            description: p.description,
            containedPermissionIds: p.containedPermissionIds,
          }))}
          type="edit"
          selectedPermissionId={props.selectedPermissionId}
        />
      ),
    })
  }).default(currentPermission);

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    formSchema={formSchema}
    okButton={{ label: t('save') }}
    onSubmit={(values) => {
      runAsynchronously(async () => {
        if (props.permissionType === 'project') {
          await stackAdminApp.updateProjectPermissionDefinition(props.selectedPermissionId, values);
        } else {
          await stackAdminApp.updateTeamPermissionDefinition(props.selectedPermissionId, values);
        }
      });
    }}
    cancelButton
  />;
}

function DeleteDialog<T extends AdminPermissionDefinition>(props: {
  permission: T,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  permissionType: PermissionType,
}) {
  const t = useTranslations('permissions.table.dialogs.delete');
  const stackAdminApp = useAdminApp();

  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    danger
    cancelButton
    okButton={{ label: t('deleteButton'), onClick: async () => {
      if (props.permissionType === 'project') {
        await stackAdminApp.deleteProjectPermissionDefinition(props.permission.id);
      } else {
        await stackAdminApp.deleteTeamPermissionDefinition(props.permission.id);
      }
    } }}
    confirmText={t('confirmText')}
  >
    {t('description', { permissionId: props.permission.id })}
  </ActionDialog>;
}

function Actions<T extends AdminPermissionDefinition>({ row, invisible, permissionType }: {
  row: Row<T>,
  invisible: boolean,
  permissionType: PermissionType,
}) {
  const t = useTranslations('permissions.table.actions');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  return (
    <div className={`flex items-center gap-2 ${invisible ? "invisible" : ""}`}>
      <EditDialog selectedPermissionId={row.original.id} open={isEditModalOpen} onOpenChange={setIsEditModalOpen} permissionType={permissionType} />
      <DeleteDialog permission={row.original} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} permissionType={permissionType} />
      <ActionCell
        items={[
          {
            item: t('edit'),
            onClick: () => setIsEditModalOpen(true),
          },
          '-',
          {
            item: t('delete'),
            danger: true,
            onClick: () => setIsDeleteModalOpen(true),
          }
        ]}
      />
    </div>
  );
}

function createColumns<T extends AdminPermissionDefinition>(permissionType: PermissionType, t: any, tTooltips: any): ColumnDef<T>[] {
  return [
    {
      accessorKey: "id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('id')} />,
      cell: ({ row }) => <TextCell size={160}>
        <div className="flex items-center gap-1">
          {row.original.id}
          {row.original.id.startsWith('$') ?
            <SimpleTooltip tooltip={tTooltips('systemPermission')} type='info'/>
            : null}
        </div>
      </TextCell>,
    },
    {
      accessorKey: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('description')} />,
      cell: ({ row }) => <TextCell size={200}>{row.getValue("description")}</TextCell>,
    },
    {
      accessorKey: "containedPermissionIds",
      header: ({ column }) => <DataTableColumnHeader
        column={column}
        columnTitle={<div className="flex items-center gap-1">
          {t('containedPermissions')}
          <SimpleTooltip tooltip={tTooltips('directPermissions')} type='info' />
        </div>}
      />,
      cell: ({ row }) => <BadgeCell size={120} badges={row.original.containedPermissionIds} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <Actions row={row} invisible={row.original.id.startsWith('$')} permissionType={permissionType} />,
    },
  ];
}

export function PermissionTable<T extends AdminPermissionDefinition>(props: {
  permissions: T[],
  permissionType: PermissionType,
}) {
  const t = useTranslations('permissions.table.columns');
  const tTooltips = useTranslations('permissions.table.tooltips');
  const tSearch = useTranslations('permissions.table');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const columns = useMemo(() => createColumns<T>(props.permissionType, t, tTooltips), [props.permissionType, t, tTooltips]);

  return <DataTable
    data={props.permissions}
    columns={columns}
    toolbarRender={(table) => toolbarRender(table, tSearch('searchPlaceholder'))}
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
