'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ProductDialog } from "@/components/payments/product-dialog";
import { ActionCell, ActionDialog, toast } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
} from "@stackframe/dashboard-ui-components";
import { useState } from "react";
import * as yup from "yup";

type BranchPayments = NonNullable<yup.InferType<typeof branchPaymentsSchema>>;

type PaymentProduct = {
  id: string,
} & BranchPayments["products"][string];

const columns: DataGridColumnDef<PaymentProduct>[] = [
  {
    id: "id",
    header: "Product ID",
    accessor: "id",
    width: 160,
    type: "string",
    sortable: false,
    renderCell: ({ value }) => (
      <span className="font-mono text-sm">{String(value)}</span>
    ),
  },
  {
    id: "displayName",
    header: "Display Name",
    accessor: "displayName",
    width: 180,
    flex: 1,
    type: "string",
    sortable: false,
  },
  {
    id: "customerType",
    header: "Customer Type",
    accessor: "customerType",
    width: 140,
    type: "string",
    sortable: false,
    renderCell: ({ value }) => (
      <span className="capitalize">{String(value)}</span>
    ),
  },
  {
    id: "freeTrial",
    header: "Free Trial",
    accessor: (row) => row.freeTrial?.join(" ") ?? "",
    width: 140,
    type: "string",
    sortable: false,
  },
  {
    id: "stackable",
    header: "Stackable",
    accessor: "stackable",
    width: 100,
    type: "boolean",
    sortable: false,
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
    renderCell: ({ row }) => <ActionsCell product={row} />,
  },
];

export function PaymentProductTable({ products }: { products: Record<string, BranchPayments["products"][string]> }) {
  const data: PaymentProduct[] = Object.entries(products)
    .map(([id, product]) => ({
      id,
      ...product,
    }));

  const [gridState, setGridState] = useState(() => createDefaultDataGridState(columns));
  const gridData = useDataSource({
    data,
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
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}
      toolbar={false}

    />
  );
}

function ActionsCell({ product }: { product: PaymentProduct }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const updateConfig = useUpdateConfig();

  return (
    <>
      <ActionCell
        items={[
          {
            item: "Edit",
            onClick: () => setIsEditOpen(true),
          },
          '-',
          {
            item: "Delete",
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
          label: "Delete",
          onClick: async () => {
            const config = await project.getConfig();
            const updatedProducts = typedFromEntries(
              typedEntries(config.payments.products)
                .filter(([productId]) => productId !== product.id)
            );
            await updateConfig({
              adminApp: stackAdminApp,
              configUpdate: { "payments.products": updatedProducts },
              pushable: true,
            });
            toast({ title: "Product deleted" });
          },
        }}
      />
    </>
  );
}
