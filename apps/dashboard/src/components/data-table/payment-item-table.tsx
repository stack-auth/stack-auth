'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { SmartFormDialog } from "@/components/form-dialog";
import { KnownErrors } from "@stackframe/stack-shared";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ActionCell, DataTable, DataTableColumnHeader, TextCell, toast } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import * as yup from "yup";

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
    cell: ({ row }) => <ActionsCell item={row.original} />,
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

function ActionsCell({ item }: { item: PaymentItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionCell
        items={[
          {
            item: "New Item Quantity Change",
            onClick: () => setOpen(true),
          },
          {
            item: "Delete",
            disabled: true,
            onClick: () => { },
          },
        ]}
      />
      <CreateItemQuantityChangeDialog
        open={open}
        onOpenChange={setOpen}
        itemId={item.id}
        customerType={item.customerType}
      />
    </>
  );
}

type CreateItemQuantityChangeDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  itemId: string,
  customerType: "user" | "team" | "custom" | undefined,
}

function CreateItemQuantityChangeDialog({ open, onOpenChange, itemId, customerType }: CreateItemQuantityChangeDialogProps) {
  const stackAdminApp = useAdminApp();

  const schema = yup.object({
    customerId: yup.string().defined().label("Customer ID"),
    quantity: yup.number().defined().label("Quantity"),
    description: yup.string().optional().label("Description"),
    expiresAt: yup.date().optional().label("Expires At"),
  });

  const submit = async (values: yup.InferType<typeof schema>) => {
    const result = await Result.fromPromise(stackAdminApp.createItemQuantityChange({
      ...(customerType === "user" ?
        { userId: values.customerId } :
        customerType === "team" ?
          { teamId: values.customerId } :
          { customCustomerId: values.customerId }
      ),
      itemId,
      quantity: values.quantity,
      expiresAt: values.expiresAt ? values.expiresAt.toISOString() : undefined,
      description: values.description,
    }));
    if (result.status === "ok") {
      toast({ title: "Item quantity change created" });
      return;
    }
    if (result.error instanceof KnownErrors.ItemNotFound) {
      toast({ title: "Item not found", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.UserNotFound) {
      toast({ title: "No user found with the given ID", variant: "destructive" });
    } else if (result.error instanceof KnownErrors.TeamNotFound) {
      toast({ title: "No team found with the given ID", variant: "destructive" });
    } else {
      toast({ title: "An unknown error occurred", variant: "destructive" });
    }
    return "prevent-close" as const;
  };

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Item Quantity Change"
      formSchema={schema}
      cancelButton
      okButton={{ label: "Create" }}
      onSubmit={submit}
    />
  );
}
