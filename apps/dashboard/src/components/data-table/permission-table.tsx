'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ActionCell, ActionDialog, SimpleTooltip } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
} from "@stackframe/dashboard-ui-components";
import { useCallback, useContext, useMemo, useState, createContext } from "react";
import { useDebounce } from "use-debounce";
import * as yup from "yup";
import { SmartFormDialog } from "../form-dialog";
import { PermissionListField } from "../permission-field";

type AdminPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};

type PermissionType = 'project' | 'team';

const SEARCH_DEBOUNCE_MS = 300;

const RefetchPermissionsContext = createContext<() => void>(() => {});

function EditDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  selectedPermissionId: string,
  permissionType: PermissionType,
}) {
  const stackAdminApp = useAdminApp();
  const refetchPermissions = useContext(RefetchPermissionsContext);
  const permissions = props.permissionType === 'project'
    ? stackAdminApp.useProjectPermissionDefinitions()
    : stackAdminApp.useTeamPermissionDefinitions();

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
    onSubmit={async (values) => {
      if (props.permissionType === 'project') {
        await stackAdminApp.updateProjectPermissionDefinition(props.selectedPermissionId, values);
      } else {
        await stackAdminApp.updateTeamPermissionDefinition(props.selectedPermissionId, values);
      }
      refetchPermissions();
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
  const refetchPermissions = useContext(RefetchPermissionsContext);

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
      refetchPermissions();
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
      sortable: false,
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
      sortable: false,
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
      sortable: false,
      cellOverflow: "wrap",
      formatValue: (value) => (Array.isArray(value) ? value.join(", ") : String(value ?? "")),
      renderCell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
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

export function PermissionTable(props: {
  permissionType: PermissionType,
  version?: number,
}) {
  const stackAdminApp = useAdminApp();
  const columns = useMemo(
    () => createColumns<AdminPermissionDefinition>(props.permissionType),
    [props.permissionType],
  );
  const [gridState, setGridState] = useDataGridUrlState(columns, {
    // Distinct prefixes for project vs team permissions so the two grids
    // can't collide if ever rendered together, and so bookmarks scoped to
    // one don't bleed into the other.
    paramPrefix: props.permissionType === "project" ? "projperms" : "teamperms",
  });
  const [internalRefetchKey, setInternalRefetchKey] = useState(0);
  const refetchPermissions = useCallback(() => setInternalRefetchKey((k) => k + 1), []);
  const refetchKey = internalRefetchKey + (props.version ?? 0);

  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);

  const dataSource = useMemo<DataGridDataSource<AdminPermissionDefinition>>(
    () => async function* (params) {
      const search = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const all = props.permissionType === 'project'
        ? await stackAdminApp.listProjectPermissionDefinitions()
        : await stackAdminApp.listTeamPermissionDefinitions();
      const filtered = search
        ? all.filter((p) => {
          const haystack = `${p.id} ${p.description ?? ""}`.toLowerCase();
          return haystack.includes(search.toLowerCase());
        })
        : all;
      yield { rows: filtered, hasMore: false };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetchKey resets pagination after mutations
    [stackAdminApp, props.permissionType, refetchKey],
  );

  const getRowId = useCallback((row: AdminPermissionDefinition) => row.id, []);

  const gridData = useDataSource({
    dataSource,
    columns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: debouncedQuickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <RefetchPermissionsContext.Provider value={refetchPermissions}>
      <DataGrid<AdminPermissionDefinition>
        columns={columns}
        rows={gridData.rows}
        getRowId={getRowId}
        isLoading={gridData.isLoading}
        isRefetching={gridData.isRefetching}
        state={gridState}
        onChange={setGridState}
        paginationMode="infinite"
        hasMore={gridData.hasMore}
        isLoadingMore={gridData.isLoadingMore}
        onLoadMore={gridData.loadMore}
        rowHeight="auto"
        estimatedRowHeight={44}
        footer={false}
        fillHeight={false}
        strings={{ searchPlaceholder: "Filter" }}
      />
    </RefetchPermissionsContext.Provider>
  );
}
