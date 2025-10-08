"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import { TeamSearchTable } from "@/components/data-table/team-search-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import {
  ActionDialog,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
  toast,
} from "@stackframe/stack-ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { ChevronsUpDown } from "lucide-react";
import { ItemDialog } from "@/components/payments/item-dialog";

type CustomerType = "user" | "team" | "custom";

type SelectedCustomer = {
  type: CustomerType,
  id: string,
  label: string,
};

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();

  const [customerType, setCustomerType] = useState<CustomerType>("user");
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);

  const items = useMemo(() => {
    const payments = config.payments;
    return Object.entries(payments.items);
  }, [config.payments]);

  const itemsForType = useMemo(
    () => items.filter(([, itemConfig]) => itemConfig.customerType === customerType),
    [items, customerType],
  );

  const paymentsConfigured = Boolean(config.payments);

  const itemDialogTitle = useMemo(() => {
    if (customerType === "user") {
      return "Create User Item";
    }
    if (customerType === "team") {
      return "Create Team Item";
    }
    return "Create Custom Item";
  }, [customerType]);

  const handleSaveItem = async (item: { id: string, displayName: string, customerType: 'user' | 'team' | 'custom' }) => {
    await project.updateConfig({ [`payments.items.${item.id}`]: { displayName: item.displayName, customerType: item.customerType } });
    setShowItemDialog(false);
  };

  return (
    <PageLayout
      title="Items"
      description="Inspect customer items and make adjustments"
      actions={<Button onClick={() => setShowItemDialog(true)}>{itemDialogTitle}</Button>}
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
        <Select
          value={customerType}
          onValueChange={(value: CustomerType) => {
            setCustomerType(value);
            setSelectedCustomer(null);
          }}
        >
          <SelectTrigger id="customer-type" className="w-full sm:w-52">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="team">Team</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        <CustomerSelector
          customerType={customerType}
          selectedCustomer={selectedCustomer}
          onSelect={setSelectedCustomer}
        />
      </div>

      {!paymentsConfigured && (
        <Typography variant="secondary">
          Payments are not configured for this project yet. Set up payments to define items.
        </Typography>
      )}

      {paymentsConfigured && itemsForType.length === 0 && (
        <Typography variant="secondary">
          {customerType === "user" && "No user items are configured yet."}
          {customerType === "team" && "No team items are configured yet."}
          {customerType === "custom" && "No custom items are configured yet."}
        </Typography>
      )}

      {paymentsConfigured && itemsForType.length > 0 && (
        <Suspense fallback={<ItemTableSkeleton rows={Math.min(itemsForType.length, 5)} />}>
          <ItemTable items={itemsForType} customer={selectedCustomer} />
        </Suspense>
      )}

      <ItemDialog
        open={showItemDialog}
        onOpenChange={setShowItemDialog}
        onSave={handleSaveItem}
        existingItemIds={items.map(([id]) => id)}
        forceCustomerType={customerType}
      />
    </PageLayout>
  );
}

type CustomerSelectorProps = {
  customerType: CustomerType,
  selectedCustomer: SelectedCustomer | null,
  onSelect: (customer: SelectedCustomer) => void,
};

function CustomerSelector(props: CustomerSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customIdDraft, setCustomIdDraft] = useState("");

  useEffect(() => {
    if (open && props.customerType === "custom") {
      setCustomIdDraft(props.selectedCustomer?.type === "custom" ? props.selectedCustomer.id : "");
    }
  }, [open, props.customerType, props.selectedCustomer]);

  const triggerLabel = props.selectedCustomer
    ? props.selectedCustomer.label
    : props.customerType === "custom"
      ? "Select customer"
      : `Select ${props.customerType}`;

  const handleSelect = (customer: SelectedCustomer) => {
    props.onSelect(customer);
    setOpen(false);
  };

  const dialogTitle = props.customerType === "custom"
    ? "Select customer"
    : `Select ${props.customerType}`;

  const dialogContent = () => {
    if (props.customerType === "user") {
      return open ? (
        <TeamMemberSearchTable
          action={(user) => (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                handleSelect({
                  type: "user",
                  id: user.id,
                  label: user.displayName ?? user.primaryEmail ?? user.id,
                })}
            >
              Select
            </Button>
          )}
        />
      ) : null;
    }
    if (props.customerType === "team") {
      return open ? (
        <TeamSearchTable
          action={(team) => (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                handleSelect({
                  type: "team",
                  id: team.id,
                  label: team.displayName,
                })}
            >
              Select
            </Button>
          )}
        />
      ) : null;
    }
    return (
      <div className="flex flex-col gap-4">
        <Typography variant="secondary">
          Enter the identifier for the custom customer.
        </Typography>
        <Input
          value={customIdDraft}
          onChange={(event) => setCustomIdDraft(event.target.value)}
          placeholder="customer-123"
        />
      </div>
    );
  };

  return (
    <ActionDialog
      trigger={
        <Button variant="outline" className="flex justify-between gap-2 overflow-x-auto w-full sm:!w-auto">
          {triggerLabel}
          <ChevronsUpDown className="w-3 h-3" />
        </Button>
      }
      title={dialogTitle}
      description={props.customerType === "custom" ? "Provide a custom customer identifier to inspect their balances." : undefined}
      open={open}
      onOpenChange={setOpen}
      cancelButton={{ label: "Close" }}
      okButton={props.customerType === "custom" ? {
        label: "Use customer",
        props: { disabled: customIdDraft.trim().length === 0 },
        onClick: async () => {
          const trimmed = customIdDraft.trim();
          if (!trimmed) {
            return "prevent-close";
          }
          handleSelect({ type: "custom", id: trimmed, label: trimmed });
        },
      } : false}
    >
      {dialogContent()}
    </ActionDialog>
  );
}

function ItemTable(props: {
  items: Array<[string, { displayName?: string | null }]>,
  customer: SelectedCustomer | null,
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[320px]">Item</TableHead>
            <TableHead className="w-[180px]">Quantity</TableHead>
            <TableHead className="w-[220px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.items.map(([itemId, itemConfig]) => (
            props.customer ? (
              <ItemRowSuspense
                key={itemId}
                itemId={itemId}
                itemDisplayName={itemConfig.displayName ?? itemId}
                customer={props.customer}
              />
            ) : (
              <TableRow key={itemId}>
                <TableCell className="align-top">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{itemConfig.displayName ?? itemId}</span>
                    <span className="text-xs font-mono text-muted-foreground">{itemId}</span>
                  </div>
                </TableCell>
                <TableCell className="align-top" />
                <TableCell className="align-top" />
              </TableRow>
            )
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ItemRowSuspense(props: ItemRowProps) {
  return (
    <Suspense
      fallback={
        <TableRow>
          <TableCell>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-12" />
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </TableCell>
        </TableRow>
      }
    >
      <ItemRowContent {...props} />
    </Suspense>
  );
}

type ItemRowProps = {
  itemId: string,
  itemDisplayName: string,
  customer: SelectedCustomer,
};

function ItemRowContent(props: ItemRowProps) {
  const adminApp = useAdminApp();
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);

  const item = useItemForCustomer(adminApp, props.customer, props.itemId);

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{props.itemDisplayName}</span>
            <span className="text-xs font-mono text-muted-foreground">{props.itemId}</span>
          </div>
        </TableCell>
        <TableCell className="align-middle">
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{item.quantity}</span>
          </div>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsAdjustOpen(true)}>
              Adjust
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <AdjustItemQuantityDialog
        open={isAdjustOpen}
        onOpenChange={setIsAdjustOpen}
        customer={props.customer}
        itemId={props.itemId}
        itemLabel={props.itemDisplayName}
      />
    </>
  );
}

function useItemForCustomer(
  adminApp: ReturnType<typeof useAdminApp>,
  customer: SelectedCustomer,
  itemId: string,
) {
  let options: Parameters<typeof adminApp.useItem>[0] = { customCustomerId: customer.id, itemId };
  if (customer.type === "user") {
    options = { userId: customer.id, itemId };
  }
  if (customer.type === "team") {
    options = { teamId: customer.id, itemId };
  }
  return adminApp.useItem(options);
}

type QuantityDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  customer: SelectedCustomer,
  itemId: string,
  itemLabel: string,
};

function AdjustItemQuantityDialog(props: QuantityDialogProps) {
  const adminApp = useAdminApp();

  const schema = useMemo(() => yup.object({
    quantity: yup
      .number()
      .defined()
      .label("Quantity change")
      .meta({
        stackFormFieldPlaceholder: "Eg. 5 or -3",
      })
      .test("non-zero", "Please enter a non-zero amount", (value) => (value !== 0)),
    description: yup
      .string()
      .optional()
      .label("Description")
      .meta({
        type: "textarea",
        stackFormFieldPlaceholder: "Optional note for your records",
        description: "Appears in transaction history for context.",
      }),
    expiresAt: yup
      .date()
      .optional()
      .label("Expires at"),
  }), []);

  const onSubmit = async (values: yup.InferType<typeof schema>) => {
    const quantity = values.quantity!;
    const customerOptions = customerToMutationOptions(props.customer);
    const result = await Result.fromPromise(adminApp.createItemQuantityChange({
      ...customerOptions,
      itemId: props.itemId,
      quantity,
      description: values.description?.trim() ? values.description.trim() : undefined,
      expiresAt: values.expiresAt ? values.expiresAt.toISOString() : undefined,
    }));

    if (result.status === "ok") {
      await refreshItem(adminApp, props.customer, props.itemId);
      toast({ title: "Item quantity updated" });
      return;
    }

    handleItemQuantityError(result.error);
    return "prevent-close";
  };

  return (
    <SmartFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Adjust “${props.itemLabel}”`}
      description="Increase or decrease the quantity by a specific amount."
      formSchema={schema}
      okButton={{ label: "Apply change" }}
      cancelButton
      onSubmit={onSubmit}
    />
  );
}


function customerToMutationOptions(customer: SelectedCustomer) {
  if (customer.type === "user") {
    return { userId: customer.id } as const;
  }
  if (customer.type === "team") {
    return { teamId: customer.id } as const;
  }
  return { customCustomerId: customer.id } as const;
}

async function refreshItem(
  adminApp: ReturnType<typeof useAdminApp>,
  customer: SelectedCustomer,
  itemId: string,
) {
  if (customer.type === "user") {
    await adminApp.getItem({ userId: customer.id, itemId });
  } else if (customer.type === "team") {
    await adminApp.getItem({ teamId: customer.id, itemId });
  } else {
    await adminApp.getItem({ customCustomerId: customer.id, itemId });
  }
}

function handleItemQuantityError(error: unknown) {
  if (error instanceof KnownErrors.ItemNotFound) {
    toast({ title: "Item not found", variant: "destructive" });
    return;
  }
  if (error instanceof KnownErrors.UserNotFound) {
    toast({ title: "User not found", variant: "destructive" });
    return;
  }
  if (error instanceof KnownErrors.TeamNotFound) {
    toast({ title: "Team not found", variant: "destructive" });
    return;
  }
  if (error instanceof KnownErrors.ItemCustomerTypeDoesNotMatch) {
    toast({
      title: "Customer type mismatch",
      description: "This item is not available for the selected customer type.",
      variant: "destructive",
    });
    return;
  }
  if (error instanceof KnownErrors.ItemQuantityInsufficientAmount) {
    toast({
      title: "Quantity too low",
      description: "This change would reduce the quantity below zero.",
      variant: "destructive",
    });
    return;
  }
  toast({ title: "Unable to update quantity", variant: "destructive" });
}

function ItemTableSkeleton(props: { rows: number }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[320px]">Item</TableHead>
            <TableHead className="w-[180px]">Quantity</TableHead>
            <TableHead className="w-[220px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: props.rows }).map((_, index) => (
            <TableRow key={index}>
              <TableCell>
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-10" />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-9 w-24" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
