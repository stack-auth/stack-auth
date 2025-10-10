'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { OfferDialog } from "@/components/payments/offer-dialog";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, DataTableI18n, TextCell, toast } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import { useMemo, useState } from "react";
import * as yup from "yup";

type PaymentOffer = {
  id: string,
} & yup.InferType<typeof branchPaymentsSchema>["offers"][string];

const getColumns = (t: any): ColumnDef<PaymentOffer>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('offerId')} />,
    cell: ({ row }) => <TextCell><span className="font-mono text-sm">{row.original.id}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('displayName')} />,
    cell: ({ row }) => <TextCell>{row.original.displayName}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "customerType",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('customerType')} />,
    cell: ({ row }) => <TextCell><span className="capitalize">{row.original.customerType}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "freeTrial",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('freeTrial')} />,
    cell: ({ row }) => <TextCell>{row.original.freeTrial?.join(" ") ?? ""}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "stackable",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('stackable')} />,
    cell: ({ row }) => <TextCell>{row.original.stackable ? t('yes') : t('no')}</TextCell>,
    enableSorting: false,
  },
  {
    id: "actions",
    cell: ({ row }) => <ActionsCell offer={row.original} />,
  }
];

export function PaymentOfferTable({ offers }: { offers: Record<string, yup.InferType<typeof branchPaymentsSchema>["offers"][string]> }) {
  const t = useTranslations('payments.offers.table.columns');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const columns = useMemo(() => getColumns(t), [t]);
  
  const data: PaymentOffer[] = Object.entries(offers).map(([id, offer]) => ({
    id,
    ...offer,
  }));

  return <DataTable
    data={data}
    columns={columns}
    defaultColumnFilters={[]}
    defaultSorting={[]}
    showDefaultToolbar={false}
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

function ActionsCell({ offer }: { offer: PaymentOffer }) {
  const t = useTranslations('payments.offers.table.actions');
  const tDialog = useTranslations('payments.offers.table.dialogs.delete');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

  return (
    <>
      <ActionCell
        items={[
          {
            item: t('edit'),
            onClick: () => setIsEditOpen(true),
          },
          '-',
          {
            item: t('delete'),
            onClick: () => setIsDeleteOpen(true),
            danger: true,
          },
        ]}
      />
      <OfferDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        project={project}
        mode="edit"
        initial={{ id: offer.id, value: offer }}
      />
      <ActionDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title={tDialog('title')}
        description={tDialog('description')}
        cancelButton
        danger
        okButton={{
          label: tDialog('deleteButton'),
          onClick: async () => {
            await project.updateConfig({ [`payments.offers.${offer.id}`]: null });
            toast({ title: tDialog('success') });
          },
        }}
      />
    </>
  );
}
