"use client";

import { InputField, SelectField } from "@/components/form-fields";
import { readableInterval } from "@/lib/dates";
import { dayIntervalSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { DayInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { Control, FieldValues, Path } from "react-hook-form";
import * as yup from "yup";
import { DayIntervalSelectorField } from "../form-fields/day-interval-selector-field";
import { KeyedRecordEditorField } from "../form-fields/keyed-record-editor-field";

type IncludedItemValue = {
  quantity: number,
  repeat?: "never" | DayInterval | undefined,
  expires?: "never" | "when-repeated" | "when-purchase-expires" | undefined,
};

export function IncludedItemEditorField<F extends FieldValues>(props: {
  itemIds: string[],
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
}) {
  return (
    <KeyedRecordEditorField
      control={props.control}
      name={props.name}
      label={props.label}
      required={props.required}
      entryLabel="Item ID"
      addButtonLabel="Add Included Item"
      renderSummary={(id, v) => (
        <>
          {id}:
          <span className="text-xs text-muted-foreground ml-2">
            {v.quantity} {v.repeat ? `/ ${readableInterval(v.repeat)}` : ""} {v.expires ? `, expires ${v.expires}` : ""}
          </span>
        </>
      )}
      toArray={(recordValue: Record<string, IncludedItemValue> | undefined) => {
        const src = recordValue || {};
        return Object.entries(src).map(([id, value]) => ({ uid: `${id}`, id, value }));
      }}
      toRecord={(rows) => Object.fromEntries(rows.map(r => [r.id, r.value]))}
      subForm={{
        title: (mode) => mode === "create" ? "Add Included Item" : "Edit Included Item",
        schema: yup.object({
          id: yup.string().oneOf(props.itemIds).defined().label("Item ID"),
          quantity: yup.number().defined().min(0).label("Quantity"),
          repeat: dayIntervalSchema.optional().label("Repeat"),
          expires: yup.string().oneOf(["never", "when-repeated", "when-purchase-expires"]).optional().label("Expires"),
        }),
        toFormValue: (id: string, value: IncludedItemValue) => ({
          id,
          quantity: value.quantity,
          repeat: value.repeat,
          expires: value.expires,
        }),
        fromFormValue: (formValue) => ({
          id: formValue.id.trim(),
          value: {
            quantity: Number(formValue.quantity),
            repeat: formValue.repeat,
            expires: formValue.expires as IncludedItemValue["expires"],
          },
        }),
        render: (sub, entryLabel) => (
          <div className="space-y-3">
            <SelectField control={sub.control} name={"id"} label={entryLabel} required options={props.itemIds.map(id => ({ value: id, label: id }))}/>
            <InputField control={sub.control} name={"quantity"} label="Quantity" type="number" />
            <DayIntervalSelectorField control={sub.control} name={"repeat"} label="Repeat" includeNever />
            <SelectField
              control={sub.control}
              name={"expires"}
              label="Expires"
              options={[
                { value: "never", label: "Never" },
                { value: "when-repeated", label: "When Repeated" },
                { value: "when-purchase-expires", label: "When Purchase Expires" },
              ]}
            />
          </div>
        ),
      }}
    />
  );
}

