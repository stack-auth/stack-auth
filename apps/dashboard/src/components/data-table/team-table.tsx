'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import { ActionCell, ActionDialog, Typography } from "@/components/ui";
import { ServerTeam } from '@hexclave/next';
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridExportField,
  type DataGridExportScope,
} from "@hexclave/dashboard-ui-components";
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
      <CreateCheckoutDialog
        open={isCreateCheckoutModalOpen}
        onOpenChange={setIsCreateCheckoutModalOpen}
        customer={{ type: "team", id: team.id, label: team.displayName }}
      />
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

const TEAM_EXPORT_FIELDS: DataGridExportField<ServerTeam>[] = [
  { key: "id", label: "Team ID", enabled: true, getValue: (team) => team.id },
  { key: "displayName", label: "Display Name", enabled: true, getValue: (team) => team.displayName },
  { key: "createdAt", label: "Created At", enabled: true, getValue: (team) => new Date(team.createdAt).toISOString() },
];

export function TeamTable() {
  const router = useRouter();
  const hexclaveAdminApp = useAdminApp();

  const [gridState, setGridState] = useDataGridUrlState(columns, {
    paramPrefix: "teams",
    initial: {
      sorting: [{ columnId: "createdAt", direction: "desc" }],
    },
  });

  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);
  const createdAtOrder = gridState.sorting.find((s) => s.columnId === "createdAt")?.direction ?? "desc";

  const dataSource = useMemo<DataGridDataSource<ServerTeam>>(
    () => async function* (params) {
      const activeSort = params.sorting.find((s) => s.columnId === "createdAt");
      const sortDesc = activeSort?.direction !== "asc";
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const search = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const result = await hexclaveAdminApp.listTeams({
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
    [hexclaveAdminApp],
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

  const fetchExportRows = useCallback(async (options: {
    scope: DataGridExportScope,
    onProgress: (fetched: number) => void,
  }) => {
    const allTeams: ServerTeam[] = [];
    let cursor: string | undefined = undefined;
    const limit = 100;
    const useFilters = options.scope === "filtered";

    do {
      const batch = await hexclaveAdminApp.listTeams({
        limit,
        orderBy: "createdAt",
        desc: createdAtOrder !== "asc",
        cursor,
        query: useFilters ? (debouncedQuickSearch || undefined) : undefined,
      });

      allTeams.push(...batch);
      options.onProgress(allTeams.length);
      cursor = batch.nextCursor ?? undefined;
    } while (cursor);

    return allTeams;
  }, [createdAtOrder, debouncedQuickSearch, hexclaveAdminApp]);

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
      exportOptions={{
        title: "Export Teams",
        description: "Configure and download team data from your project",
        entityName: "team",
        entityNamePlural: "teams",
        filenamePrefix: "stack-teams-export",
        fields: TEAM_EXPORT_FIELDS,
        fetchRows: fetchExportRows,
        emptyExportTitle: "No teams to export",
        emptyExportDescription: "There are no teams matching the current filters",
        allScopeLabel: "Export all teams in the project",
        filteredScopeLabel: (
          <>
            Export only filtered/searched teams
            {debouncedQuickSearch && (
              <span className="text-muted-foreground ml-1">
                (search: &quot;{debouncedQuickSearch}&quot;)
              </span>
            )}
          </>
        ),
      }}
      onRowClick={(row) => {
        router.push(`/projects/${encodeURIComponent(hexclaveAdminApp.projectId)}/teams/${encodeURIComponent(row.id)}`);
      }}
    />
  );
}
