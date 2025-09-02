"use client";

import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { Button, Card, CardHeader, CardTitle, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@stackframe/stack-ui";
import { Edit2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Control, FieldValues, Path, UseFormReturn, useWatch } from "react-hook-form";
import { FormDialog } from "../form-dialog";
import * as yup from "yup";

type KeyedRow<TValue> = {
  uid: string,
  id: string,
  value: TValue,
};

type Props<F extends FieldValues, SubF extends FieldValues, TValue> = {
  control: Control<F>,
  name: Path<F>,
  label: React.ReactNode,
  required?: boolean,
  disabled?: boolean,

  entryLabel: string,
  addButtonLabel: string,
  renderSummary: (id: string, value: TValue) => React.ReactNode,
  toArray: (recordValue: Record<string, TValue> | undefined) => KeyedRow<TValue>[],
  toRecord: (rows: KeyedRow<TValue>[]) => Record<string, TValue>,

  subForm: {
    schema: yup.ObjectSchema<SubF>,
    toFormValue: (id: string, value: TValue) => SubF,
    fromFormValue: (formValue: SubF) => { id: string, value: TValue },
    render: (form: UseFormReturn<SubF, any, undefined>, entryLabel: string) => React.ReactNode,
    title: (mode: "create" | "edit" | undefined) => string,
  },
}

export function KeyedRecordEditorField<F extends FieldValues, SubF extends FieldValues, TValue>(props: Props<F, SubF, TValue>) {
  const fieldValue = useWatch({ control: props.control, name: props.name });
  const { toArray, subForm } = props;
  const [rows, setRows] = useState<KeyedRow<TValue>[]>([]);

  useEffect(() => {
    const currentRows = toArray(fieldValue as any);
    const oldMap = new Map(rows.map(r => [r.id, r.uid]));
    const next = currentRows.map(r => ({ ...r, uid: oldMap.get(r.id) ?? generateUuid() }));
    const same = rows.length === next.length && rows.every((r, i) => r.id === next[i]?.id && JSON.stringify(r.value) === JSON.stringify(next[i]?.value) && r.uid === next[i]?.uid);
    if (!same) {
      setRows(next);
    }
  }, [fieldValue, rows, toArray]);

  const [editing, setEditing] = useState<null | { mode: "create" } | { mode: "edit", rowUid: string }>(null);

  const editingDefaults = useMemo(() => {
    if (!editing) {
      return undefined;
    }
    if (editing.mode === "create") {
      return undefined;
    }
    const row = rows.find(r => r.uid === editing.rowUid);
    if (!row) {
      return undefined;
    }
    return subForm.toFormValue(row.id, row.value);
  }, [editing, rows, subForm]);

  return (
    <FormField
      control={props.control as any}
      name={props.name as any}
      render={({ field }) => {
        const sync = (newRows: KeyedRow<TValue>[]) => {
          setRows(newRows);
          const asRecord = props.toRecord(newRows);
          field.onChange(asRecord as any);
        };

        const upsertRow = (row: KeyedRow<TValue>) => {
          const index = rows.findIndex(r => r.uid === row.uid);
          const next = index >= 0 ? rows.map(r => (r.uid === row.uid ? row : r)) : [...rows, row];
          sync(next);
        };

        const removeRow = (uid: string) => {
          sync(rows.filter(r => r.uid !== uid));
        };

        const startCreate = () => setEditing({ mode: "create" });
        const startEdit = (uid: string) => setEditing({ mode: "edit", rowUid: uid });
        const stopEditing = () => setEditing(null);

        const handleSubSubmit = async (values: SubF) => {
          const { id, value } = props.subForm.fromFormValue(values);
          if (editing?.mode === "edit") {
            const prev = rows.find(r => r.uid === editing.rowUid);
            const uid = prev?.uid ?? generateUuid();
            upsertRow({ uid, id, value });
          } else {
            upsertRow({ uid: generateUuid(), id, value });
          }
        };

        return (
          <FormItem>
            <FormLabel>{props.label}{props.required ? <span className="text-zinc-500">*</span> : null}</FormLabel>
            <FormControl>
              <div className="space-y-2">
                <div className="space-y-2">
                  {!props.disabled && rows.map(row => (
                    <Card key={row.uid} className="border">
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 px-4">
                        <CardTitle className="text-sm font-medium lowercase overflow-x-scroll whitespace-nowrap">
                          {props.renderSummary(row.id, row.value)}
                        </CardTitle>
                        <div className="flex items-center">
                          <Button type="button" variant="ghost" size="icon" onClick={() => startEdit(row.uid)} aria-label="Edit">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.uid)} aria-label="Delete">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardHeader>
                    </Card>
                  ))}
                </div>

                <div className="flex justify-center">
                  <Button type="button" variant="outline" onClick={startCreate} disabled={props.disabled}>
                    <Plus className="mr-2 h-4 w-4" /> {props.addButtonLabel}
                  </Button>
                </div>
              </div>
            </FormControl>
            <FormMessage />

            <FormDialog
              key={editing?.mode}
              open={editing !== null}
              onOpenChange={(open) => { if (!open) stopEditing(); }}
              title={subForm.title(editing?.mode)}
              okButton={{ label: editing?.mode === "create" ? "Add" : "Save" }}
              cancelButton
              defaultValues={editingDefaults}
              formSchema={subForm.schema}
              onSubmit={async (v) => {
                await handleSubSubmit(v);
              }}
              render={(sub) => subForm.render(sub, props.entryLabel)}
            />
          </FormItem>
        );
      }}
    />
  );
}

