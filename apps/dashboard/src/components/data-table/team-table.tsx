'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import { ActionCell, ActionDialog, Typography } from "@/components/ui";
import { ServerTeam } from '@stackframe/stack';
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import React, { useMemo, useState } from "react";
import * as yup from "yup";
import { FormDialog } from "../form-dialog";
import { InputField } from "../form-fields";
import { CreateCheckoutDialog } from "../payments/create-checkout-dialog";

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

export function TeamTable(props: { teams: ServerTeam[] }) {
  const router = useRouter();
  const stackAdminApp = useAdminApp();

  const [gridState, setGridState] = useState<DataGridState>(() => ({
    ...createDefaultDataGridState(columns),
    sorting: [{ columnId: "createdAt", direction: "desc" }],
  }));

  const gridData = useDataSource({
    data: props.teams,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      isLoading={gridData.isLoading}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}

      onRowClick={(row) => {
        router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/teams/${encodeURIComponent(row.id)}`);
      }}
    />
  );
}
