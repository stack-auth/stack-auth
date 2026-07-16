"use client";

import { TeamSearchTable } from "@/components/data-table/team-search-table";
import { UserPickerTable } from "@/components/data-table/user-picker-table";
import {
  ActionDialog,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Typography,
} from "@/components/ui";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

export type CustomerType = "user" | "team" | "custom";

export type SelectedCustomer = {
  type: CustomerType,
  id: string,
  label: string,
};

/**
 * Maps a selected customer onto the keyed-options object that the admin SDK
 * mutation methods (`grantProduct`, `createItemQuantityChange`,
 * `createCheckoutUrl`, `getItem`, …) expect.
 */
export function customerToMutationOptions(customer: SelectedCustomer) {
  if (customer.type === "user") {
    return { userId: customer.id } as const;
  }
  if (customer.type === "team") {
    return { teamId: customer.id } as const;
  }
  return { customCustomerId: customer.id } as const;
}

type CustomerSelectorProps = {
  customerType: CustomerType,
  selectedCustomer: SelectedCustomer | null,
  onSelect: (customer: SelectedCustomer) => void,
  className?: string,
};

/**
 * A trigger button that opens a dialog letting the admin pick a concrete
 * customer of the given `customerType`:
 * - "user"   → searchable user table
 * - "team"   → searchable team table
 * - "custom" → free-text identifier input
 *
 * Shared between the Customers dashboard page and the Create-checkout dialog.
 */
export function CustomerSelector(props: CustomerSelectorProps) {
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
        <UserPickerTable
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
        <Button variant="outline" className={`flex justify-between gap-2 overflow-x-auto w-full sm:!w-auto ${props.className ?? ""}`}>
          {triggerLabel}
          <CaretUpDownIcon className="w-3 h-3" />
        </Button>
      }
      title={dialogTitle}
      description={props.customerType === "custom" ? "Provide a custom customer identifier." : undefined}
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

type CustomerTypeSelectProps = {
  value: CustomerType,
  onValueChange: (value: CustomerType) => void,
  id?: string,
  className?: string,
};

/** A small Type dropdown (User / Team / Custom) used alongside CustomerSelector. */
export function CustomerTypeSelect(props: CustomerTypeSelectProps) {
  return (
    <Select value={props.value} onValueChange={(value) => props.onValueChange(value as CustomerType)}>
      <SelectTrigger id={props.id} className={props.className ?? "w-full sm:w-52"}>
        <SelectValue placeholder="Select type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">User</SelectItem>
        <SelectItem value="team">Team</SelectItem>
        <SelectItem value="custom">Custom</SelectItem>
      </SelectContent>
    </Select>
  );
}
