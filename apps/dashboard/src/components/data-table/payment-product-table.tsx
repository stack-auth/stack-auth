'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ProductDialog } from "@/components/payments/product-dialog";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, DataTableI18n, TextCell, toast } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import { useMemo, useState } from "react";
import * as yup from "yup";

type PaymentProduct = {
  id: string,
} & yup.InferType<typeof branchPaymentsSchema>["products"][string];

const getColumns = (t: any): ColumnDef<PaymentProduct>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Product ID" />,
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
    cell: ({ row }) => <ActionsCell product={row.original} />,
  }
];

export function PaymentProductTable({ products }: { products: Record<string, yup.InferType<typeof branchPaymentsSchema>["products"][string]> }) {
    const t = useTranslations('payments.offers.table.columns');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const columns = useMemo(() => getColumns(t), [t]);
  const data: PaymentProduct[] = Object.entries(products).map(([id, product]) => ({
    id,
    ...product,
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

function ActionsCell({ product }: { product: PaymentProduct }) {
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
      <ProductDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        project={project}
        mode="edit"
        initial={{ id: product.id, value: product }}
      />
      <ActionDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete Product"
        description="This action will permanently delete this product."
        cancelButton
        danger
        okButton={{
          label: tDialog('deleteButton'),
          onClick: async () => {
            await project.updateConfig({ [`payments.products.${product.id}`]: null });
            toast({ title: "Product deleted" });
          },
        }}
      />
    </>
  );
}
