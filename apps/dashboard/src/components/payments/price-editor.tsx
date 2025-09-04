"use client";

import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { InputField } from "@/components/form-fields";
import { Control, FieldValues, Path } from "react-hook-form";
import { KeyedRecordEditorField } from "../form-fields/keyed-record-editor-field";
import { dayIntervalSchema, userSpecifiedIdSchema } from "@stackframe/stack-shared/dist/schema-fields";
import * as yup from "yup";
import { readableInterval } from "@/lib/dates";
import { DayIntervalSelectorField } from "../form-fields/day-interval-selector-field";

type OfferPrice = {
  USD: string,
  interval?: DayInterval,
  freeTrial?: DayInterval,
};

export function PriceEditorField<F extends FieldValues>(props: {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
  disabled?: boolean,
}) {
  return (
    <KeyedRecordEditorField
      control={props.control}
      name={props.name}
      label={props.label}
      required={props.required}
      disabled={props.disabled}
      entryLabel="Price ID"
      addButtonLabel="Add Price"
      renderSummary={(id, price) => {
        const amount = price.USD;
        const interval = price.interval ? readableInterval(price.interval) : undefined;
        return (
          <>
            {id}:
            <span className="text-xs text-muted-foreground ml-2">
              ({amount ? `$${amount}` : "No amount"} {interval ? ` / ${interval}` : ""})
            </span>
          </>
        );
      }}
      toArray={(recordValue) => {
        const src = recordValue || {};
        return Object.entries(src).map(([id, value]) => ({ uid: `${id}`, id, value }));
      }}
      toRecord={(rows) => Object.fromEntries(rows.map(r => [r.id, r.value]))}
      subForm={{
        title: (mode) => mode === "create" ? "Add Price" : "Edit Price",
        schema: yup.object({
          id: userSpecifiedIdSchema("priceId").defined(),
          USD: yup.string().defined().label("Price (USD)"),
          interval: dayIntervalSchema.optional().label("Interval"),
        }),
        toFormValue: (id: string, value: OfferPrice) => typeof value === "string" ? value : ({
          id,
          USD: value.USD,
          interval: value.interval,
        }),
        fromFormValue: (formValue) => ({
          id: String(formValue.id).trim(),
          value: {
            USD: formValue.USD,
            interval: formValue.interval,
          },
        }),
        render: (sub, entryLabel) => (
          <div className="space-y-3">
            <InputField control={sub.control} name={"id"} label={entryLabel} placeholder="standard" required />
            <InputField control={sub.control} name={"USD"} label="Price (USD)" type="number" />
            <DayIntervalSelectorField control={sub.control} name={"interval"} label="Interval" unsetLabel="One time" />
          </div>
        ),
      }}
    />
  );
}
