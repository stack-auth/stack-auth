'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { useRouter } from "@/components/router";
import { ServerTeam } from '@stackframe/stack';
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, DataTableI18n, DateCell, SearchToolbarItem, TextCell, Typography } from "@stackframe/stack-ui";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import React, { useState } from "react";
import * as yup from "yup";
import { FormDialog } from "../form-dialog";
import { InputField } from "../form-fields";
import { CreateCheckoutDialog } from "../payments/create-checkout-dialog";

function toolbarRender<TData>(table: Table<TData>, searchPlaceholder: string) {
  return (
    <>
      <SearchToolbarItem table={table} keyName="displayName" placeholder={searchPlaceholder} />
    </>
  );
}

const teamFormSchema = yup.object({
  displayName: yup.string(),
});

function EditDialog(props: {
  team: ServerTeam,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const t = useTranslations('teams.table.dialogs.edit');
  const defaultValues = {
    displayName: props.team.displayName,
  };

  return <FormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    formSchema={teamFormSchema}
    defaultValues={defaultValues}
    okButton={{ label: t('save') }}
    render={(form) => (
      <>
        <Typography variant='secondary'>{t('id')}: {props.team.id}</Typography>
        <InputField control={form.control} label={t('displayName')} name="displayName" />
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
  const t = useTranslations('teams.table.dialogs.delete');
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    danger
    cancelButton
    okButton={{ label: t('deleteButton'), onClick: async () => { await props.team.delete(); } }}
    confirmText={t('confirmText')}
  >
    {t('description', { teamName: props.team.displayName, teamId: props.team.id })}
  </ActionDialog>;
}

function Actions({ row }: { row: Row<ServerTeam> }) {
  const t = useTranslations('teams.table.actions');
  const router = useRouter();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isCreateCheckoutModalOpen, setIsCreateCheckoutModalOpen] = useState(false);
  const adminApp = useAdminApp();

  return (
    <>
      <EditDialog team={row.original} open={isEditModalOpen} onOpenChange={setIsEditModalOpen} />
      <DeleteDialog team={row.original} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} />
      <CreateCheckoutDialog open={isCreateCheckoutModalOpen} onOpenChange={setIsCreateCheckoutModalOpen} team={row.original} />
      <ActionCell
        items={[
          {
            item: t('viewMembers'),
            onClick: () => router.push(`/projects/${adminApp.projectId}/teams/${row.original.id}`),
          },
          {
            item: t('edit'),
            onClick: () => setIsEditModalOpen(true),
          },
          {
            item: t('createCheckout'),
            onClick: () => setIsCreateCheckoutModalOpen(true),
          },
          '-',
          {
            item: t('delete'),
            danger: true,
            onClick: () => setIsDeleteModalOpen(true),
          }
        ]}
      />
    </>
  );
}

const getColumns = (t: any): ColumnDef<ServerTeam>[] =>  [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('id')} />,
    cell: ({ row }) => <TextCell size={60}>{row.original.id}</TextCell>,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('displayName')} />,
    cell: ({ row }) => <TextCell size={200}>{row.original.displayName}</TextCell>,
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('createdAt')} />,
    cell: ({ row }) => <DateCell date={row.original.createdAt}></DateCell>,
  },
  {
    id: "actions",
    cell: ({ row }) => <Actions row={row} />,
  },
];

export function TeamTable(props: { teams: ServerTeam[] }) {
  const t = useTranslations('teams.table.columns');
  const tSearch = useTranslations('teams.table');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const columns = React.useMemo(() => getColumns(t), [t]);
  
  return <DataTable
    data={props.teams}
    columns={columns}
    toolbarRender={(table) => toolbarRender(table, tSearch('searchPlaceholder'))}
    defaultColumnFilters={[]}
    defaultSorting={[{ id: 'createdAt', desc: true }]}
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
