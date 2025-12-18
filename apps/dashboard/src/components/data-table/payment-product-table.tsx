'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ProductDialog } from "@/components/payments/product-dialog";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, TextCell, toast } from "@/components/ui";
import { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import * as yup from "yup";

type PaymentProduct = {
  id: string,
} & yup.InferType<typeof branchPaymentsSchema>["products"][string];

const columns: ColumnDef<PaymentProduct>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Product ID" />,
    cell: ({ row }) => <TextCell><span className="font-mono text-sm">{row.original.id}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Display Name" />,
    cell: ({ row }) => <TextCell>{row.original.displayName}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "customerType",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer Type" />,
    cell: ({ row }) => <TextCell><span className="capitalize">{row.original.customerType}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "freeTrial",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Free Trial" />,
    cell: ({ row }) => <TextCell>{row.original.freeTrial?.join(" ") ?? ""}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "stackable",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Stackable" />,
    cell: ({ row }) => <TextCell>{row.original.stackable ? "Yes" : "No"}</TextCell>,
    enableSorting: false,
  },
  {
    id: "actions",
    cell: ({ row }) => <ActionsCell product={row.original} />,
  }
];

export function PaymentProductTable({ products }: { products: Record<string, yup.InferType<typeof branchPaymentsSchema>["products"][string]> }) {
  const data: PaymentProduct[] = Object.entries(products)
    .map(([id, product]) => ({
      id,
      ...product,
    }));

  return <DataTable
    data={data}
    columns={columns}
    defaultColumnFilters={[]}
    defaultSorting={[]}
    showDefaultToolbar={false}
  />;
}

function ActionsCell({ product }: { product: PaymentProduct }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

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
            const config = project.useConfig();
            const updatedProducts = typedFromEntries(
              typedEntries(config.payments.products)
                .filter(([productId]) => productId !== product.id)
            );
            await project.updateConfig({ "payments.products": updatedProducts });
            toast({ title: "Product deleted" });
          },
        }}
      />
    </>
  );
}
