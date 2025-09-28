'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { SmartFormDialog } from "@/components/form-dialog";
import { ItemDialog } from "@/components/payments/item-dialog";
import { KnownErrors } from "@stackframe/stack-shared";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { has } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, TextCell, toast } from "@stackframe/stack-ui";
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
    id: "actions",
    cell: ({ row }) => <ActionsCell item={row.original} />,
  }
];

export function PaymentItemTable({ items }: { items: Record<string, yup.InferType<typeof branchPaymentsSchema>["items"][string]> }) {
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
  />;
}

function ActionsCell({ item }: { item: PaymentItem }) {
  const [open, setOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  return (
    <>
      <ActionCell
        items={[
          {
            item: "Update Customer Quantity",
            onClick: () => setOpen(true),
          },
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
      <CreateItemQuantityChangeDialog
        open={open}
        onOpenChange={setOpen}
        itemId={item.id}
        customerType={item.customerType}
      />
      <ItemDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        project={project}
        mode="edit"
        initial={{ id: item.id, value: item }}
      />
      <ActionDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete Item"
        description="This will delete the item"
        cancelButton
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            const config = await project.getConfig();
            for (const [offerId, offer] of Object.entries(config.payments.offers)) {
              if (has(offer.includedItems, item.id)) {
                toast({
                  title: "Item is included in offer",
                  description: `Please remove it from the offer "${offerId}" before deleting.`,
                  variant: "destructive",
                });
                return "prevent-close";
              }
            }
            await project.updateConfig({
              [`payments.items.${item.id}`]: null,
            });
            toast({ title: "Item deleted" });
          }
        }}
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
