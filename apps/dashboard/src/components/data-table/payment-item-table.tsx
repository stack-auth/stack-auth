'use client';
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { SmartFormDialog } from "@/components/form-dialog";
import { ItemDialog } from "@/components/payments/item-dialog";
import { KnownErrors } from "@stackframe/stack-shared";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { has } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ActionCell, ActionDialog, DataTable, DataTableColumnHeader, DataTableI18n, TextCell, toast } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import { useMemo, useState } from "react";
import * as yup from "yup";

type PaymentItem = {
  id: string,
} & yup.InferType<typeof branchPaymentsSchema>["items"][string];

const getColumns = (t: any): ColumnDef<PaymentItem>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('itemId')} />,
    cell: ({ row }) => <TextCell><span className="font-mono text-sm">{row.original.id}</span></TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "displayName",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('displayName')} />,
    cell: ({ row }) => <TextCell>{row.original.displayName ?? ""}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "customerType",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('customerType')} />,
    cell: ({ row }) => <TextCell><span className="capitalize">{row.original.customerType}</span></TextCell>,
    enableSorting: false,
  },
  {
    id: "actions",
    cell: ({ row }) => <ActionsCell item={row.original} />,
  }
];

export function PaymentItemTable({ items }: { items: Record<string, yup.InferType<typeof branchPaymentsSchema>["items"][string]> }) {
  const t = useTranslations('payments.items.table.columns');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const columns = useMemo(() => getColumns(t), [t]);
  
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

function ActionsCell({ item }: { item: PaymentItem }) {
  const t = useTranslations('payments.items.table.actions');
  const tDialog = useTranslations('payments.items.table.dialogs.delete');
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
            item: t('updateQuantity'),
            onClick: () => setOpen(true),
          },
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
        title={tDialog('title')}
        description={tDialog('description')}
        cancelButton
        danger
        okButton={{
          label: tDialog('deleteButton'),
          onClick: async () => {
            const config = await project.getConfig();
            for (const [productId, product] of Object.entries(config.payments.products)) {
              if (has(product.includedItems, item.id)) {
                toast({
                  title: tDialog('errorInOffer'),
                  description: tDialog('errorInOfferDescription', { productId }),
                  variant: "destructive",
                });
                return "prevent-close";
              }
            }
            await project.updateConfig({
              [`payments.items.${item.id}`]: null,
            });
            toast({ title: tDialog('success') });
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
  const t = useTranslations('payments.items.table.dialogs.quantityChange');
  const stackAdminApp = useAdminApp();

  const schema = yup.object({
    customerId: yup.string().defined().label(t('customerIdLabel')),
    quantity: yup.number().defined().label(t('quantityLabel')),
    description: yup.string().optional().label(t('descriptionLabel')),
    expiresAt: yup.date().optional().label(t('expiresAtLabel')),
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
      toast({ title: t('success') });
      return;
    }
    if (result.error instanceof KnownErrors.ItemNotFound) {
      toast({ title: t('errorItemNotFound'), variant: "destructive" });
    } else if (result.error instanceof KnownErrors.UserNotFound) {
      toast({ title: t('errorUserNotFound'), variant: "destructive" });
    } else if (result.error instanceof KnownErrors.TeamNotFound) {
      toast({ title: t('errorTeamNotFound'), variant: "destructive" });
    } else {
      toast({ title: t('errorUnknown'), variant: "destructive" });
    }
    return "prevent-close" as const;
  };

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      formSchema={schema}
      cancelButton
      okButton={{ label: t('createButton') }}
      onSubmit={submit}
    />
  );
}
