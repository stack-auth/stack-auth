'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, SearchToolbarItem, SimpleTooltip, TextCell } from "@stackframe/stack-ui";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useState } from "react";
import * as yup from "yup";
import { SmartFormDialog } from "../form-dialog";
import { PermissionListField } from "../permission-field";

type AdminPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};

type PermissionType = 'user' | 'team';

function toolbarRender<TData>(table: Table<TData>) {
  return (
    <>
      <SearchToolbarItem table={table} keyName="id" placeholder="Filter by ID" />
    </>
  );
}

function EditDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  selectedPermissionId: string,
  permissionType: PermissionType,
}) {
  const stackAdminApp = useAdminApp();
  const permissions = props.permissionType === 'user'
    ? stackAdminApp.useUserPermissionDefinitions()
    : stackAdminApp.useTeamPermissionDefinitions();
  const currentPermission = permissions.find((p) => p.id === props.selectedPermissionId);
  if (!currentPermission) {
    return null;
  }

  const formSchema = yup.object({
    id: yup.string()
      .defined()
      .notOneOf(permissions.map((p) => p.id).filter(p => p !== props.selectedPermissionId), "ID already exists")
      .matches(/^[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":" and "_" are allowed')
      .label("ID"),
    description: yup.string().label("Description"),
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

  const updatePermission = props.permissionType === 'user'
    ? stackAdminApp.updateUserPermissionDefinition
    : stackAdminApp.updateTeamPermissionDefinition;

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Edit Permission"
    formSchema={formSchema}
    okButton={{ label: "Save" }}
    onSubmit={(values) => {
      runAsynchronously(async () => {
        await updatePermission(props.selectedPermissionId, values);
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
  const stackApp = useAdminApp();
  const deletePermission = props.permissionType === 'user'
    ? stackApp.deleteUserPermissionDefinition
    : stackApp.deleteTeamPermissionDefinition;

  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete Permission"
    danger
    cancelButton
    okButton={{ label: "Delete Permission", onClick: async () => { await deletePermission(props.permission.id); } }}
    confirmText="I understand this will remove the permission from all users and other permissions that contain it."
  >
    {`Are you sure you want to delete the permission "${props.permission.id}"?`}
  </ActionDialog>;
}

function Actions<T extends AdminPermissionDefinition>({ row, invisible, permissionType }: {
  row: Row<T>,
  invisible: boolean,
  permissionType: PermissionType,
}) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  return (
    <div className={`flex items-center gap-2 ${invisible ? "invisible" : ""}`}>
      <EditDialog selectedPermissionId={row.original.id} open={isEditModalOpen} onOpenChange={setIsEditModalOpen} permissionType={permissionType} />
      <DeleteDialog permission={row.original} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} permissionType={permissionType} />
      <ActionCell
        items={[
          {
            item: "Edit",
            onClick: () => setIsEditModalOpen(true),
          },
          '-',
          {
            item: "Delete",
            danger: true,
            onClick: () => setIsDeleteModalOpen(true),
          }
        ]}
      />
    </div>
  );
}

function createColumns<T extends AdminPermissionDefinition>(permissionType: PermissionType): ColumnDef<T>[] {
  return [
    {
      accessorKey: "id",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="ID" />,
      cell: ({ row }) => <TextCell size={160}>
        <div className="flex items-center gap-1">
          {row.original.id}
          {row.original.id.startsWith('$') ?
            <SimpleTooltip tooltip="Built-in system permissions are prefixed with $. They cannot be edited or deleted, but can be contained in other permissions." type='info'/>
            : null}
        </div>
      </TextCell>,
    },
    {
      accessorKey: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Description" />,
      cell: ({ row }) => <TextCell size={200}>{row.getValue("description")}</TextCell>,
    },
    {
      accessorKey: "containedPermissionIds",
      header: ({ column }) => <DataTableColumnHeader
        column={column}
        columnTitle={<div className="flex items-center gap-1">
          Contained Permissions
          <SimpleTooltip tooltip="Only showing permissions that are contained directly (non-recursive)." type='info' />
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
  const columns = createColumns<T>(props.permissionType);

  return <DataTable
    data={props.permissions}
    columns={columns}
    toolbarRender={toolbarRender}
    defaultColumnFilters={[]}
    defaultSorting={[]}
  />;
}
