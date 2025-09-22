'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { OfferDialog } from "@/components/payments/offer-dialog";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, TextCell, toast } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import * as yup from "yup";

type PaymentOffer = {
  id: string,
} & yup.InferType<typeof branchPaymentsSchema>["offers"][string];

const columns: ColumnDef<PaymentOffer>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Offer ID" />,
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
    cell: ({ row }) => <ActionsCell offer={row.original} />,
  }
];

export function PaymentOfferTable({ offers }: { offers: Record<string, yup.InferType<typeof branchPaymentsSchema>["offers"][string]> }) {
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
  />;
}

function ActionsCell({ offer }: { offer: PaymentOffer }) {
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
        title="Delete Offer"
        description="This action will permanently delete this offer."
        cancelButton
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            await project.updateConfig({ [`payments.offers.${offer.id}`]: null });
            toast({ title: "Offer deleted" });
          },
        }}
      />
    </>
  );
}
