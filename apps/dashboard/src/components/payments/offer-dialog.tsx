"use client";

import { FormDialog } from "@/components/form-dialog";
import { CheckboxField, InputField, SelectField } from "@/components/form-fields";
import { IncludedItemEditorField } from "@/components/payments/included-item-editor";
import { PriceEditorField } from "@/components/payments/price-editor";
import { AdminProject } from "@stackframe/stack";
import { offerSchema, priceOrIncludeByDefaultSchema, userSpecifiedIdSchema, yupRecord } from "@stackframe/stack-shared/dist/schema-fields";
import { has } from "@stackframe/stack-shared/dist/utils/objects";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, FormLabel, FormItem, FormMessage, toast, FormField, Checkbox, FormControl, SimpleTooltip } from "@stackframe/stack-ui";
import * as yup from "yup";

type Props = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  project: AdminProject,
} & (
    {
      mode: "create",
      initial?: never,
    } | {
      mode: "edit",
      initial: {
        id: string,
        value: yup.InferType<typeof offerSchema>,
      },
    }
  )

export function OfferDialog({ open, onOpenChange, project, mode, initial }: Props) {
  const config = project.useConfig();
  const localOfferSchema = yup.object({
    offerId: userSpecifiedIdSchema("offerId").defined().label("Offer ID"),
    displayName: yup.string().defined().label("Display Name"),
    customerType: yup.string().oneOf(["user", "team", "custom"]).defined().label("Customer Type"),
    prices: priceOrIncludeByDefaultSchema.defined().label("Prices").test("at-least-one-price", (value, context) => {
      if (value !== "include-by-default" && Object.keys(value).length === 0) {
        return context.createError({ message: "At least one price is required" });
      }
      return true;
    }),
    includedItems: yupRecord(
      userSpecifiedIdSchema("itemId"),
      yup.object({
        quantity: yup.number().defined(),
        repeat: yup.mixed().optional(),
        expires: yup.string().oneOf(["never", "when-purchase-expires", "when-repeated"]).optional(),
      }),
    ).default({}).label("Included Items"),
    serverOnly: yup.boolean().default(false).label("Server Only"),
    stackable: yup.boolean().default(false).label("Stackable"),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? "Create New Offer" : "Edit Offer"}
      formSchema={localOfferSchema}
      defaultValues={initial?.value ? {
        offerId: initial.id,
        ...initial.value,
      } : undefined}
      okButton={{ label: mode === "create" ? "Create Offer" : "Save" }}
      cancelButton
      onSubmit={async (values) => {
        if (mode === "create") {
          const config = await project.getConfig();
          if (has(config.payments.offers, values.offerId)) {
            toast({ title: "An offer with this ID already exists", variant: "destructive" });
            return "prevent-close-and-prevent-reset";
          }
        }
        const payload = {
          displayName: values.displayName,
          customerType: values.customerType,
          prices: values.prices,
          includedItems: values.includedItems,
          serverOnly: values.serverOnly,
          stackable: values.stackable,
        };
        await project.updateConfig({ [`payments.offers.${values.offerId}`]: payload });
      }}
      render={(form) => (
        <div className="space-y-4">
          <InputField control={form.control} name={"offerId"} label="Offer ID" required disabled={mode === "edit"} placeholder="team" />
          <InputField control={form.control} name={"displayName"} label="Display Name" required placeholder="Team" />
          <SelectField control={form.control} name={"customerType"} label="Customer Type" required options={[
            { value: "user", label: "User" },
            { value: "team", label: "Team" },
            { value: "custom", label: "Custom" },
          ]} />

          <PriceEditorField control={form.control} name={"prices"} label="Prices" required disabled={form.watch("prices") === "include-by-default"} />
          <IncludedItemEditorField itemIds={Object.keys(config.payments.items)} control={form.control} name={"includedItems"} label="Included Items" />
          <Accordion type="single" collapsible>
            <AccordionItem value="item-1" className="border-0">
              <AccordionTrigger>More Options</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <CheckboxField
                  control={form.control}
                  name={"serverOnly"}
                  label={
                    <SimpleTooltip tooltip="Restricts purchases to only server-side calls">
                      Server Only
                    </SimpleTooltip>
                  }
                />
                <CheckboxField
                  control={form.control}
                  name={"stackable"}
                  label={
                    <SimpleTooltip tooltip="Allow user to purchase multiple">
                      Stackable
                    </SimpleTooltip>
                  }
                />
                <FormField
                  control={form.control}
                  name={"prices"}
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md p-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value === "include-by-default"}
                          onCheckedChange={(checked) => field.onChange(checked ? "include-by-default" : {})}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>
                          <SimpleTooltip tooltip="The default offer that is included in the group">
                            Include by default
                          </SimpleTooltip>
                        </FormLabel>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    />
  );
}


