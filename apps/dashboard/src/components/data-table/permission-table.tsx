'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, ActionDialog, SimpleTooltip } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
} from "@stackframe/dashboard-ui-components";
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

function EditDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  selectedPermissionId: string,
  permissionType: PermissionType,
}) {
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
      .matches(/^[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":" and "_" are allowed')
      .label("ID")
      .meta({
        stackFormFieldExtraProps: {
          disabled: true,
        },
      }),
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

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Edit Permission"
    formSchema={formSchema}
    okButton={{ label: "Save" }}
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
  const stackAdminApp = useAdminApp();

  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete Permission"
    danger
    cancelButton
    okButton={{ label: "Delete Permission", onClick: async () => {
      if (props.permissionType === 'project') {
        await stackAdminApp.deleteProjectPermissionDefinition(props.permission.id);
      } else {
        await stackAdminApp.deleteTeamPermissionDefinition(props.permission.id);
      }
    } }}
    confirmText="I understand this will remove the permission from all users and other permissions that contain it."
  >
    {`Are you sure you want to delete the permission "${props.permission.id}"?`}
  </ActionDialog>;
}

function Actions<T extends AdminPermissionDefinition>({ permission, invisible, permissionType }: {
  permission: T,
  invisible: boolean,
  permissionType: PermissionType,
}) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  return (
    <div className={`flex items-center gap-2 ${invisible ? "invisible" : ""}`}>
      <EditDialog selectedPermissionId={permission.id} open={isEditModalOpen} onOpenChange={setIsEditModalOpen} permissionType={permissionType} />
      <DeleteDialog permission={permission} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} permissionType={permissionType} />
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

function createColumns<T extends AdminPermissionDefinition>(permissionType: PermissionType): DataGridColumnDef<T>[] {
  return [
    {
      id: "id",
      header: "ID",
      accessor: "id",
      width: 180,
      type: "string",
      renderCell: ({ row }) => (
        <div className="flex max-w-[180px] items-center gap-1">
          <span className="truncate font-mono text-xs text-muted-foreground">{row.id}</span>
          {row.id.startsWith('$') ?
            <SimpleTooltip tooltip="Built-in system permissions are prefixed with $. They cannot be edited or deleted, but can be contained in other permissions." type='info'/>
            : null}
        </div>
      ),
    },
    {
      id: "description",
      header: "Description",
      accessor: "description",
      width: 200,
      flex: 1,
      type: "string",
      renderCell: ({ value }) => (
        <span className="truncate">{String(value ?? "")}</span>
      ),
    },
    {
      id: "containedPermissionIds",
      header: () => (
        <div className="flex items-center gap-1">
          Contained Permissions
          <SimpleTooltip tooltip="Only showing permissions that are contained directly (non-recursive)." type='info' />
        </div>
      ),
      accessor: "containedPermissionIds",
      width: 120,
      type: "custom",
      formatValue: (value) => (Array.isArray(value) ? value.join(", ") : String(value ?? "")),
      renderCell: ({ row }) => (
        <div className="flex max-w-[120px] flex-wrap items-center gap-1">
          {row.containedPermissionIds.map((id) => (
            <Badge key={id} variant="secondary">{id}</Badge>
          ))}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      hideable: false,
      resizable: false,
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      renderCell: ({ row }) => (
        <Actions
          permission={row}
          invisible={row.id.startsWith('$')}
          permissionType={permissionType}
        />
      ),
    },
  ];
}

export function PermissionTable<T extends AdminPermissionDefinition>(props: {
  permissions: T[],
  permissionType: PermissionType,
}) {
  const columns = useMemo(
    () => createColumns<T>(props.permissionType),
    [props.permissionType],
  );
  const [gridState, setGridState] = useState(() => createDefaultDataGridState(columns));

  const gridData = useDataSource({
    data: props.permissions,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DataGrid<T>
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}

      strings={{ searchPlaceholder: "Filter by ID" }}
    />
  );
}
