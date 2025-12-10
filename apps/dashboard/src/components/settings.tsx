import { yupResolver } from "@hookform/resolvers/yup";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, cn, DelayedInput, Form, Label, Select, SelectContent, SelectTrigger, SelectValue, Switch, Typography, useToast } from "@stackframe/stack-ui";
import { Settings } from "lucide-react";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { FieldValues, useForm } from "react-hook-form";
import * as yup from "yup";
import { CopyableText } from "./copyable-text";


export const SettingCard = React.memo(function SettingCard(props: {
  title?: string,
  description?: React.ReactNode,
  actions?: React.ReactNode,
  children?: React.ReactNode,
  accordion?: string,
  className?: string,
}) {
  return (
    <Card className={cn("transition-all", props.className)}>
      {(props.title || props.description) && (
        <CardHeader>
          {props.title && <CardTitle>{props.title}</CardTitle>}
          {props.description && <CardDescription>{props.description}</CardDescription>}
        </CardHeader>
      )}

      <CardContent className="space-y-4">
        {props.accordion ?
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>{props.accordion}</AccordionTrigger>
              <AccordionContent>
                {props.children}
              </AccordionContent>
            </AccordionItem>
          </Accordion> :
          props.children}

      </CardContent>
      {props.actions && <CardFooter>
        <div className="w-full flex justify-end gap-2">
          {props.actions}
        </div>
      </CardFooter>}
    </Card>
  );
});

export const SettingSwitch = React.memo(function SettingSwitch(props: {
  label: string | React.ReactNode,
  hint?: string | React.ReactNode,
  checked?: boolean,
  disabled?: boolean,
  onCheckedChange: (checked: boolean) => void | Promise<void>,
  actions?: React.ReactNode,
  onlyShowActionsWhenChecked?: boolean,
}) {
  const id = useId();
  const [checkedState, setCheckedState] = useState(props.checked);
  const checked = props.checked ?? checkedState;
  const showActions = !props.onlyShowActionsWhenChecked || checked;
  const { onCheckedChange: propOnCheckedChange } = props;

  const onCheckedChange = useCallback((checked: boolean) => {
    setCheckedState(checked);
    runAsynchronouslyWithAlert(propOnCheckedChange(checked));
  }, [propOnCheckedChange]);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-3">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch
            id={id}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={props.disabled}
          />
          <Label className="cursor-pointer" htmlFor={id}>
            <Typography className="text-sm font-medium leading-none">
              {props.label}
            </Typography>
          </Label>
        </div>
        {props.hint && (
          <Typography variant="secondary" className="text-xs pl-9">
            {props.hint}
          </Typography>
        )}
      </div>
      {showActions && props.actions && (
        <div className="flex items-center">
          {props.actions}
        </div>
      )}
    </div>
  );
});

export const SettingIconButton = forwardRefIfNeeded<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>((props, ref) => {
  return (
    <Button variant='ghost' size='sm' className="h-8 w-8 p-0" onClick={props.onClick} ref={ref}>
      <Settings className="w-4 h-4 text-muted-foreground" />
    </Button>
  );
});
SettingIconButton.displayName = "SettingIconButton";

export const SettingInput = React.memo(function SettingInput(props: {
  label: string,
  hint?: string | React.ReactNode,
  defaultValue?: string,
  onChange?: (value: string) => void | Promise<void>,
  actions?: React.ReactNode,
  className?: string,
}) {
  const { onChange } = props;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    runAsynchronouslyWithAlert(onChange?.(e.target.value));
  }, [onChange]);

  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {props.label}
        </Label>
        {props.actions}
      </div>
      <DelayedInput
        className="max-w-lg"
        defaultValue={props.defaultValue}
        onChange={handleChange}
      />
      {props.hint && (
        <Typography variant="secondary" className="text-xs">
          {props.hint}
        </Typography>
      )}
    </div>
  );
});

export const SettingText = React.memo(function SettingText(props: {
  label: React.ReactNode,
  hint?: string | React.ReactNode,
  children: React.ReactNode,
  className?: string,
}) {
  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <Label className="text-sm font-medium">
        {props.label}
      </Label>
      <div className="text-sm">
        {props.children}
      </div>
      {props.hint && (
        <Typography variant="secondary" className="text-xs">
          {props.hint}
        </Typography>
      )}
    </div>
  );
});

export const SettingCopyableText = React.memo(function SettingCopyableText(props: {
  label: React.ReactNode,
  value: string,
  hint?: string | React.ReactNode,
  className?: string,
}) {
  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <Label className="text-sm font-medium">
        {props.label}
      </Label>
      <CopyableText value={props.value} />
      {props.hint && (
        <Typography variant="secondary" className="text-xs">
          {props.hint}
        </Typography>
      )}
    </div>
  );
});

// Note: Generic components can't use React.memo directly with type parameters,
// but we can still optimize the internal callback
export function SettingSelect<TValue extends string>(props: {
  label: string | React.ReactNode,
  hint?: string | React.ReactNode,
  value?: TValue,
  placeholder?: string,
  disabled?: boolean,
  loading?: boolean,
  onValueChange?: (value: TValue) => void | Promise<void>,
  actions?: React.ReactNode,
  children: React.ReactNode,
  className?: string,
}) {
  const id = useId();
  const [valueState, setValueState] = useState<TValue | undefined>(props.value);
  const value = props.value ?? valueState;
  const { onValueChange: propOnValueChange } = props;

  const onValueChange = useCallback(async (value: TValue) => {
    setValueState(value);
    await propOnValueChange?.(value);
  }, [propOnValueChange]);

  const handleValueChange = useCallback((value: TValue) => {
    runAsynchronouslyWithAlert(onValueChange(value));
  }, [onValueChange]);

  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-medium">
          {props.label}
        </Label>
        {props.actions}
      </div>
      <Select
        value={value}
        onValueChange={handleValueChange}
        disabled={props.disabled || props.loading}
      >
        <SelectTrigger id={id} className="max-w-lg" loading={props.loading}>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent className="max-w-lg">
          {props.children}
        </SelectContent>
      </Select>
      {props.hint && (
        <Typography variant="secondary" className="text-xs">
          {props.hint}
        </Typography>
      )}
    </div>
  );
}

export function FormSettingCard<F extends FieldValues>(
  props: Omit<React.ComponentProps<typeof SettingCard>, 'children' | 'actions'> & {
    defaultValues?: F,
    onSubmit: (values: F) => Promise<void> | void,
    render: (form: ReturnType<typeof useForm<F>>) => React.ReactNode,
    formSchema: yup.ObjectSchema<F>,
    submitLabel?: string,
    cancelLabel?: string,
  }
) {
  const formId = useId();
  const form = useForm<F>({
    resolver: yupResolver(props.formSchema) as any,
    defaultValues: props.defaultValues as any,
    mode: "onChange",
  });
  const [submitting, setSubmitting] = useState(false);
  const buttonsDisabled = submitting || !form.formState.isDirty;
  const { toast } = useToast();
  const { onSubmit: propsOnSubmit } = props;

  const onSubmit = useCallback(async (values: F, e?: React.BaseSyntheticEvent) => {
    e?.preventDefault();
    setSubmitting(true);
    await propsOnSubmit(values);
    form.reset(values);
    toast({ title: 'Your changes have been saved', variant: 'success' });
    setSubmitting(false);
  }, [propsOnSubmit, form, toast]);

  const handleFormSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    runAsynchronously(
      async () => {
        setSubmitting(true);
        await form.handleSubmit(onSubmit)(e);
        setSubmitting(false);
      },
      {
        onError: (error) => {
          alert(`Failed to save changes: ${error instanceof Error ? error.message : 'An error occurred'}`);
          setSubmitting(false);
        }
      }
    );
  }, [form, onSubmit]);

  const handleCancel = useCallback(() => {
    form.reset();
  }, [form]);

  // Only reset when defaultValues change, not when form object changes
  const defaultValuesRef = useRef(props.defaultValues);
  useEffect(() => {
    if (props.defaultValues !== defaultValuesRef.current) {
      defaultValuesRef.current = props.defaultValues;
      form.reset(props.defaultValues as any);
    }
  }, [props.defaultValues, form]);

  return (
    <SettingCard {...props} actions={
      <>
        <Button
          onClick={handleCancel}
          variant='secondary'
          size="sm"
          disabled={buttonsDisabled}
        >
          {props.cancelLabel || 'Cancel'}
        </Button>
        <Button
          form={formId}
          type="submit"
          size="sm"
          loading={submitting}
          disabled={buttonsDisabled}
        >
          {props.submitLabel || 'Save'}
        </Button>
      </>
    }>
      <Form {...(form as any)}>
        <form onSubmit={handleFormSubmit} className="space-y-4" id={formId}>
          {props.render(form)}
        </form>
      </Form>
    </SettingCard>
  );
}
