'use client';
import { DataTable, DataTableColumnHeader, TextCell, ActionCell, Button } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import * as yup from "yup";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";

type PaymentItem = {
  id: string,
} & yup.InferType<typeof branchPaymentsSchema>["items"][string];

const columns: ColumnDef<PaymentItem>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Item ID" />,
    cell: ({ row }) => <TextCell><span className="font-mono text-sm">{row.original.id}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Display Name" />,
    cell: ({ row }) => <TextCell>{row.original.displayName ?? ""}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "customerType",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer Type" />,
    cell: ({ row }) => <TextCell><span className="capitalize">{row.original.customerType}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "default.quantity",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Default Quantity" />,
    cell: ({ row }) => <TextCell>{row.original.default.quantity}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "default.repeat",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Default Repeat" />,
    cell: ({ row }) => <TextCell>
      {row.original.default.repeat === "never" ? "Never" : row.original.default.repeat?.join(" ") ?? ""}
    </TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "default.expires",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Default Expires" />,
    cell: ({ row }) => <TextCell><span className="capitalize">{row.original.default.expires || "Never"}</span></TextCell>,
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

export function PaymentItemTable({
  items,
  toolbarRender,
}: {
  items: Record<string, yup.InferType<typeof branchPaymentsSchema>["items"][string]>,
  toolbarRender: () => React.ReactNode,
}) {
  const data: PaymentItem[] = Object.entries(items).map(([id, item]) => ({
    id,
    ...item,
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
