"use client";

import { ActionDialog, ActionDialogProps, Form } from "@/components/ui";
import { yupResolver } from "@hookform/resolvers/yup";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import React, { useEffect, useId, useState } from "react";
import { FieldValues, useForm } from "react-hook-form";
import * as yup from "yup";
import { SmartForm } from "./smart-form";

// Parametrize on the schema's inferred shape `F` rather than the whole schema type `S`
// (see SmartForm): TypeScript 7 checks yup's `concat` method contravariantly, so a
// concrete `ObjectSchema` is no longer assignable to `ObjectSchema<any, ...>`. The
// default/flags params are left as `any` so `.default()` schemas (flag `"d"`) are accepted.
export function SmartFormDialog<F extends FieldValues>(
  props: Omit<ActionDialogProps, 'children'> & {
    formSchema: yup.ObjectSchema<F, yup.AnyObject, any, any>,
    defaultValues?: Partial<F>,
    onSubmit: (values: F) => Promise<void | 'prevent-close'> | void | 'prevent-close',
  },
) {
  const formId = `${useId()}-form`;
  const [submitting, setSubmitting] = useState(false);
  const [openState, setOpenState] = useState(false);
  const okButton = props.okButton === false ? false : {
    onClick: async () => "prevent-close" as const,
    ...(typeof props.okButton === "boolean" ? {} : props.okButton),
    props: {
      form: formId,
      type: "submit" as const,
      loading: submitting,
      ...((typeof props.okButton === "boolean") ? {} : props.okButton?.props),
    },
  };
  const handleSubmit = async (values: F) => {
    const res = await props.onSubmit(values);
    if (res !== 'prevent-close') {
      setOpenState(false);
      props.onOpenChange?.(false);
      props.onClose?.();
    }
  };

  return (
    <ActionDialog
      {...props}
      open={props.open ?? openState}
      onOpenChange={(open) => {
        setOpenState(open);
        props.onOpenChange?.(open);
      }}
      okButton={okButton}
    >
      <SmartForm
        formSchema={props.formSchema}
        onSubmit={handleSubmit}
        onChangeIsSubmitting={setSubmitting}
        formId={formId}
        defaultValues={props.defaultValues}
        isOpen={props.open ?? openState}
      />
    </ActionDialog>
  );
}

export function FormDialog<F extends FieldValues>(
  props: Omit<ActionDialogProps, 'children'> & {
    defaultValues?: Partial<F>,
    onSubmit: (values: F) => Promise<void | 'prevent-close' | 'prevent-close-and-prevent-reset'> | void | 'prevent-close' | 'prevent-close-and-prevent-reset',
    render: (form: ReturnType<typeof useForm<F>>) => React.ReactNode,
    formSchema: yup.ObjectSchema<F>,
    onFormChange?: (form: ReturnType<typeof useForm<F>>) => void,
  }
) {
  const formId = useId();
  const form = useForm({
    resolver: yupResolver(props.formSchema),
    defaultValues: props.defaultValues as any,
    mode: "onChange",
  });
  const [openState, setOpenState] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const okButton = props.okButton === false ? false : {
    onClick: async () => "prevent-close" as const,
    ...(typeof props.okButton == "boolean" ? {} : props.okButton),
    props: {
      form: formId,
      type: "submit" as const,
      loading: submitting,
      ...((typeof props.okButton == "boolean") ? {} : props.okButton?.props),
    },
  };

  const onSubmit = async (values: F, e?: React.BaseSyntheticEvent) => {
    e?.preventDefault();
    setSubmitting(true);
    try {
      const result = await props.onSubmit(values);
      if (result !== 'prevent-close-and-prevent-reset') {
        form.reset();

        if (result !== 'prevent-close') {
          setOpenState(false);
          props.onClose?.();
          props.onOpenChange?.(false);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Only reset form when dialog opens, not when defaultValues changes during editing
  // This prevents user edits from being lost due to background data refetches
  // Track resolved open state to handle both controlled (props.open) and uncontrolled (openState) modes
  const resolvedOpen = props.open ?? openState;
  const prevOpen = React.useRef(resolvedOpen);
  useEffect(() => {
    const currentResolvedOpen = props.open ?? openState;
    // Reset form when dialog transitions from closed to open
    if (currentResolvedOpen && !prevOpen.current) {
      form.reset(props.defaultValues);
    }
    prevOpen.current = currentResolvedOpen;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, openState, props.defaultValues]);

  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
      props.onFormChange?.(form);
    });
    return () => subscription.unsubscribe();
  }, [form, form.watch, props]);

  return (
    <ActionDialog
      {...props}
      open={props.open ?? openState}
      onOpenChange={(open) => {
        if (open) setOpenState(true);
        props.onOpenChange?.(open);
      }}
      onClose={() => {
        form.reset();
        setOpenState(false);
        runAsynchronouslyWithAlert(props.onClose?.());
      }}
      okButton={okButton}
    >
      <Form {...(form)}>
        <form
          onSubmit={(e) => {
            e.stopPropagation();
            return runAsynchronouslyWithAlert(form.handleSubmit(onSubmit)(e));
          }}
          className="space-y-4"
          id={formId}
        >
          {props.render(form)}
        </form>
      </Form>
    </ActionDialog>
  );
}
