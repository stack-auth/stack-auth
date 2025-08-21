"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { DayIntervalSelectorField } from "@/components/form-fields/day-interval-selector-field";
import { AdminProject } from "@stackframe/stack";
import { branchPaymentsSchema } from "@stackframe/stack-shared/dist/config/schema";
import { AccordionContent, AccordionItem, Accordion, toast, AccordionTrigger } from "@stackframe/stack-ui";
import { dayIntervalOrNeverSchema, userSpecifiedIdSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { has } from "@stackframe/stack-shared/dist/utils/objects";
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
    defaultQuantity: yup.number().min(0).default(0).label("Default Quantity"),
    defaultRepeat: dayIntervalOrNeverSchema.optional().label("Default Repeat"),
    defaultExpires: yup.string().oneOf(["never", "when-repeated"]).optional().label("Default Expires"),
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
            default: {
              quantity: values.defaultQuantity,
              repeat: values.defaultRepeat,
              expires: values.defaultExpires,
            },
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

          <Accordion type="single" collapsible>
            <AccordionItem value="item-1" className="border-0">
              <AccordionTrigger>Defaults</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <InputField control={form.control} name={"defaultQuantity"} label="Quantity" type="number" />
                <DayIntervalSelectorField control={form.control} name={"defaultRepeat"} label="Repeat" unsetLabel="None" />
                <SelectField control={form.control} name={"defaultExpires"} label="Expires" options={[
                  { value: "never", label: "Never" },
                  { value: "when-repeated", label: "When Repeated" },
                ]} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    />
  );
}


