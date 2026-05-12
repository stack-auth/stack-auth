'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import { ActionCell, ActionDialog, Typography } from "@/components/ui";
import { ServerTeam } from '@stackframe/stack';
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
} from "@stackframe/dashboard-ui-components";
import React, { useCallback, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import * as yup from "yup";
import { FormDialog } from "../form-dialog";
import { InputField } from "../form-fields";
import { CreateCheckoutDialog } from "../payments/create-checkout-dialog";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const teamFormSchema = yup.object({
  displayName: yup.string(),
});

function EditDialog(props: {
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const defaultValues = {
    displayName: props.team.displayName,
  };

  return <FormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Edit Team"
    formSchema={teamFormSchema}
    defaultValues={defaultValues}
    okButton={{ label: "Save" }}
    render={(form) => (
      <>
        <Typography variant='secondary'>ID: {props.team.id}</Typography>
        <InputField control={form.control} label="Display Name" name="displayName" />
      </>
    )}
    onSubmit={async (values) => await props.team.update(values)}
    cancelButton
  />;
}

function DeleteDialog(props: {
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Delete Team"
    danger
    cancelButton
    okButton={{ label: "Delete Team", onClick: async () => { await props.team.delete(); } }}
    confirmText="I understand that this action cannot be undone and all the team members will be also removed from the team."
  >
    {`Are you sure you want to delete the team "${props.team.displayName}" with ID ${props.team.id}?`}
  </ActionDialog>;
}

function TeamActions({ team }: { team: ServerTeam }) {
  const router = useRouter();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isCreateCheckoutModalOpen, setIsCreateCheckoutModalOpen] = useState(false);
  const adminApp = useAdminApp();

  return (
    <>
      <EditDialog team={team} open={isEditModalOpen} onOpenChange={setIsEditModalOpen} />
      <DeleteDialog team={team} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} />
      <CreateCheckoutDialog open={isCreateCheckoutModalOpen} onOpenChange={setIsCreateCheckoutModalOpen} team={team} />
      <ActionCell
        items={[
          {
            item: "View Members",
            onClick: () => router.push(`/projects/${encodeURIComponent(adminApp.projectId)}/teams/${encodeURIComponent(team.id)}`),
          },
          {
            item: "Edit",
            onClick: () => setIsEditModalOpen(true),
          },
          {
            item: "Create Checkout",
            onClick: () => setIsCreateCheckoutModalOpen(true),
          },
          '-',
          {
            item: "Delete",
            danger: true,
            onClick: () => setIsDeleteModalOpen(true),
          }
        ]}
      />
    </>
  );
}

const columns: DataGridColumnDef<ServerTeam>[] = [
  {
    id: "id",
    header: "ID",
    accessor: "id",
    width: 120,
    type: "string",
    sortable: false,
    renderCell: ({ value }) => (
      <span className="truncate font-mono text-xs text-muted-foreground">{String(value)}</span>
    ),
  },
  {
    id: "displayName",
    header: "Display Name",
    accessor: "displayName",
    width: 200,
    flex: 1,
    type: "string",
    sortable: false,
    renderCell: ({ value }) => (
      <span className="truncate">{String(value ?? "")}</span>
    ),
  },
  {
    id: "createdAt",
    header: "Created At",
    accessor: "createdAt",
    width: 140,
    type: "dateTime",
  },
  {
    id: "actions",
    header: "",
    width: 50,
    minWidth: 50,
    maxWidth: 50,
    sortable: false,
    hideable: false,
    resizable: false,
    renderCell: ({ row }) => <TeamActions team={row} />,
  },
];

export function TeamTable() {
  const router = useRouter();
  const stackAdminApp = useAdminApp();

  const [gridState, setGridState] = useDataGridUrlState(columns, {
    paramPrefix: "teams",
    initial: {
      sorting: [{ columnId: "createdAt", direction: "desc" }],
    },
  });

  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);

  const dataSource = useMemo<DataGridDataSource<ServerTeam>>(
    () => async function* (params) {
      const activeSort = params.sorting.find((s) => s.columnId === "createdAt");
      const sortDesc = activeSort?.direction !== "asc";
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const search = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const result = await stackAdminApp.listTeams({
        limit: PAGE_SIZE,
        orderBy: "createdAt",
        desc: sortDesc,
        cursor,
        query: search,
      });
      yield {
        rows: result,
        hasMore: result.nextCursor != null,
        nextCursor: result.nextCursor ?? undefined,
      };
    },
    [stackAdminApp],
  );

  const getRowId = useCallback((row: ServerTeam) => row.id, []);

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
    <DataGrid
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
      onRowClick={(row) => {
        router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/teams/${encodeURIComponent(row.id)}`);
      }}
    />
  );
}
