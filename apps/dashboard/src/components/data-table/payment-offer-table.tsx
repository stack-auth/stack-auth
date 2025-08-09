'use client';
import { ActionCell, Button, DataTable, DataTableColumnHeader, TextCell } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import * as yup from "yup";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";

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
    cell: ({ row }) => <ActionCell
      items={[
        {
          item: "Delete",
          disabled: true,
          onClick: () => { },
        },
      ]}
    />,
  }
];

export function PaymentOfferTable({
  offers,
  toolbarRender,
}: {
  offers: Record<string, yup.InferType<typeof branchPaymentsSchema>["offers"][string]>,
  toolbarRender: () => React.ReactNode,
}) {
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
    toolbarRender={toolbarRender}
  />;
}
