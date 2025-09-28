"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { AdminProject } from "@stackframe/stack";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { userSpecifiedIdSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { has } from "@stackframe/stack-shared/dist/utils/objects";
import { toast } from "@stackframe/stack-ui";
import * as yup from "yup";

type Props = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  project: AdminProject,
} & (
    {
      mode: "create",
      initial?: undefined,
    } | {
      mode: "edit",
      initial: {
        id: string,
        value: yup.InferType<typeof branchPaymentsSchema>["items"][string],
      },
    }
  )

export function ItemDialog({ open, onOpenChange, project, mode, initial }: Props) {
  const itemSchema = yup.object({
    itemId: userSpecifiedIdSchema("itemId").defined().label("Item ID"),
    displayName: yup.string().optional().label("Display Name"),
    customerType: yup.string().oneOf(["user", "team", "custom"]).defined().label("Customer Type"),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? "Create New Item" : "Edit Item"}
      formSchema={itemSchema}
      okButton={{ label: mode === "create" ? "Create Item" : "Save" }}
      cancelButton
      defaultValues={initial?.value ? {
        itemId: initial.id,
        ...initial.value,
      } : undefined}
      onSubmit={async (values) => {
        if (mode === "create") {
          const config = await project.getConfig();
          const itemId = values.itemId;
          if (has(config.payments.items, itemId)) {
            toast({ title: "An item with this ID already exists", variant: "destructive" });
            return "prevent-close-and-prevent-reset";
          }
        }
        await project.updateConfig({
          [`payments.items.${values.itemId}`]: {
            displayName: values.displayName,
            customerType: values.customerType,
          },
        });
      }}
      render={(form) => (
        <div className="space-y-4">
          <InputField control={form.control} name={"itemId"} label="Item ID" required placeholder="pro-features" disabled={mode === "edit"} />
          <SelectField control={form.control} name={"customerType"} label="Customer Type" required options={[
            { value: "user", label: "User" },
            { value: "team", label: "Team" },
            { value: "custom", label: "Custom" },
          ]} />
          <InputField control={form.control} name={"displayName"} label="Display Name" placeholder="Pro Features" />
        </div>
      )}
    />
  );
}


