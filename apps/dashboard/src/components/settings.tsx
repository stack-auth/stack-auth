import { yupResolver } from "@hookform/resolvers/yup";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { forwardRefIfNeeded } from "@stackframe/stack-shared/dist/utils/react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, DelayedInput, Form, Label, Select, SelectContent, SelectTrigger, SelectValue, Switch, Typography, useToast } from "@stackframe/stack-ui";
import { Settings } from "lucide-react";
import React, { useEffect, useId, useState } from "react";
import { FieldValues, useForm } from "react-hook-form";
import * as yup from "yup";


export function SettingCard(props: {
  title?: string,
  description?: string,
  actions?: React.ReactNode,
  children?: React.ReactNode,
  accordion?: string,
  className?: string,
}) {
  return (
    <Card className={props.className}>
      {(props.title || props.description) && (
        <CardHeader>
          {props.title && <CardTitle>{props.title}</CardTitle>}
          {props.description && <CardDescription>{props.description}</CardDescription>}
        </CardHeader>
      )}

      <CardContent className="flex flex-col gap-4">
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
}

export function SettingSwitch(props: {
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

  const onCheckedChange = async (checked: boolean) => {
    setCheckedState(checked);
    await props.onCheckedChange(checked);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={props.disabled}
        />
        <Label className='px-2' htmlFor={id}>{props.label}</Label>
        {showActions && props.actions}
      </div>
      {props.hint && <Typography variant="secondary" type="footnote">{props.hint}</Typography>}
    </div>
  );
}

export const SettingIconButton = forwardRefIfNeeded<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>((props, ref) => {
  return (
    <Button variant='ghost' size='sm' className="p-1 h-full" onClick={props.onClick} ref={ref}>
      <Settings className="w-4 h-4 text-muted-foreground" />
    </Button>
  );
});
SettingIconButton.displayName = "SettingIconButton";

export function SettingInput(props: {
  label: string,
  defaultValue?: string,
  onChange?: (value: string) => void | Promise<void>,
  actions?: React.ReactNode,
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{props.label}</Label>
      <DelayedInput
        className="max-w-lg"
        defaultValue={props.defaultValue}
        onChange={(e) => runAsynchronouslyWithAlert(props.onChange?.(e.target.value))}
      />
      {props.actions}
    </div>
  );
}

export function SettingText(props: {
  label: React.ReactNode,
  children: React.ReactNode,
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{props.label}</Label>
      <div>
        {props.children}
      </div>
    </div>
  );
}

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
}) {
  const id = useId();
  const [valueState, setValueState] = useState<TValue | undefined>(props.value);
  const value = props.value ?? valueState;

  const onValueChange = async (value: TValue) => {
    setValueState(value);
    await props.onValueChange?.(value);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <Label className='pr-2' htmlFor={id}>{props.label}</Label>
        {props.actions}
      </div>
      <Select
        value={value}
        onValueChange={(value: TValue) => runAsynchronouslyWithAlert(onValueChange(value))}
        disabled={props.disabled || props.loading}
      >
        <SelectTrigger id={id} className="max-w-lg" loading={props.loading}>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent
          className="max-w-lg"
        >
          {props.children}
        </SelectContent>
      </Select>
      {props.hint && <Typography variant="secondary" type="footnote">{props.hint}</Typography>}
    </div>
  );
}

export function FormSettingCard<F extends FieldValues>(
  props: Omit<React.ComponentProps<typeof SettingCard>, 'children' | 'actions'> & {
    defaultValues?: Partial<F>,
    onSubmit: (values: F) => Promise<void> | void,
    render: (form: ReturnType<typeof useForm<F>>) => React.ReactNode,
    formSchema: yup.ObjectSchema<F>,
  }
) {
  const formId = useId();
  const form = useForm({
    resolver: yupResolver(props.formSchema),
    defaultValues: props.defaultValues as any,
    mode: "onChange",
  });
  const [submitting, setSubmitting] = useState(false);
  const buttonsDisabled = submitting || !form.formState.isDirty;
  const { toast } = useToast();

  const onSubmit = async (values: F, e?: React.BaseSyntheticEvent) => {
    e?.preventDefault();
    setSubmitting(true);
    try {
      await props.onSubmit(values);
      form.reset();
      toast({ title: 'Your changes have been saved', variant: 'success' });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    form.reset(props.defaultValues);
  }, [props.defaultValues, form]);

  return (
    <SettingCard {...props} actions={
      <>
        <Button onClick={() => form.reset()} variant='secondary' disabled={buttonsDisabled}>Cancel</Button>
        <Button form={formId} type="submit" loading={submitting} disabled={buttonsDisabled}>Save</Button>
      </>
    }>
      <Form {...form}>
        <form onSubmit={e => runAsynchronouslyWithAlert(form.handleSubmit(onSubmit)(e))} className="space-y-4" id={formId}>
          {props.render(form)}
        </form>
      </Form>
    </SettingCard>
  );
}
