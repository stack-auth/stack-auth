import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerUser } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { emailSchema, jsonStringOrEmptySchema, passwordSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Typography, useToast } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import * as yup from "yup";
import { FormDialog } from "./form-dialog";
import { DateField, InputField, SwitchField, TextAreaField } from "./form-fields";

export function UserDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
} & ({
  type: 'create',
} | {
  type: 'edit',
  user: ServerUser,
})) {
  const t = useTranslations('users.dialog');
  const tFields = useTranslations('users.dialog.fields');
  const tHints = useTranslations('users.dialog.hints');
  const tErrors = useTranslations('users.dialog.errors');
  const { toast } = useToast();
  const adminApp = useAdminApp();
  const project = adminApp.useProject();

  let defaultValues;
  if (props.type === 'edit') {
    defaultValues = {
      displayName: props.user.displayName || undefined,
      primaryEmail: props.user.primaryEmail || undefined,
      primaryEmailVerified: props.user.primaryEmailVerified,
      signedUpAt: props.user.signedUpAt,
      clientMetadata: props.user.clientMetadata == null ? "" : JSON.stringify(props.user.clientMetadata, null, 2),
      clientReadOnlyMetadata: props.user.clientReadOnlyMetadata == null ? "" : JSON.stringify(props.user.clientReadOnlyMetadata, null, 2),
      serverMetadata: props.user.serverMetadata == null ? "" : JSON.stringify(props.user.serverMetadata, null, 2),
      passwordEnabled: props.user.hasPassword,
      otpAuthEnabled: props.user.otpAuthEnabled,
      updatePassword: false,
    };
  } else {
    defaultValues = {
      signedUpAt: new Date(),
    };
  }

  const formSchema = yup.object({
    primaryEmail: emailSchema.label(tFields('primaryEmail')).defined().nonEmpty(),
    displayName: yup.string().optional(),
    signedUpAt: yup.date().defined(),
    clientMetadata: jsonStringOrEmptySchema.default("null"),
    clientReadOnlyMetadata: jsonStringOrEmptySchema.default("null"),
    serverMetadata: jsonStringOrEmptySchema.default("null"),
    primaryEmailVerified: yup.boolean().optional(),
    password: passwordSchema.min(1).test({
      name: 'password-required',
      message: tErrors('passwordRequired'),
      test: (value, context) => {
        if (context.parent.passwordEnabled && (context.parent.updatePassword || props.type === 'create')) {
          return value != null;
        }
        return true;
      },
    }).optional(),
    otpAuthEnabled: yup.boolean().test({
      name: 'otp-verified',
      message: tHints('emailVerifiedRequired'),
      test: (value, context) => {
        return context.parent.primaryEmailVerified || !value;
      },
    }).optional(),
    passwordEnabled: yup.boolean().optional(),
    updatePassword: yup.boolean().optional(),
  });

  async function handleSubmit(values: yup.InferType<typeof formSchema>) {
    const userValues = {
      ...values,
      primaryEmailAuthEnabled: true,
      clientMetadata: values.clientMetadata ? JSON.parse(values.clientMetadata) : undefined,
      clientReadOnlyMetadata: values.clientReadOnlyMetadata ? JSON.parse(values.clientReadOnlyMetadata) : undefined,
      serverMetadata: values.serverMetadata ? JSON.parse(values.serverMetadata) : undefined
    };

    try {
      if (props.type === 'edit') {
        await props.user.update(userValues);
      } else {
        await adminApp.createUser(userValues);
      }
    } catch (error) {
      if (KnownErrors.UserWithEmailAlreadyExists.isInstance(error)) {
        toast({
          title: tErrors('emailAlreadyExists'),
          description: tErrors('emailAlreadyExistsDescription'),
          variant: "destructive",
        });
        return 'prevent-close';
      }
    }
  }

  return <FormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    trigger={props.trigger}
    title={props.type === 'edit' ? t('editTitle') : t('createTitle')}
    formSchema={formSchema}
    defaultValues={defaultValues}
    okButton={{ label: props.type === 'edit' ? t('saveButton') : t('createButton') }}
    render={(form) => (
      <>
        {props.type === 'edit' ? <Typography variant='secondary'>{tFields('id')}: {props.user.id}</Typography> : null}

        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <InputField control={form.control} label={tFields('primaryEmail')} name="primaryEmail" required />
          </div>
          <div className="mb-2">
            <SwitchField control={form.control} label={tFields('verified')} name="primaryEmailVerified" />
          </div>
        </div>

        <InputField control={form.control} label={tFields('displayName')} name="displayName" />

        <DateField control={form.control} label={tFields('signedUpAt')} name="signedUpAt" />

        {project.config.magicLinkEnabled && <SwitchField control={form.control} label={tFields('otpAuthEnabled')} name="otpAuthEnabled" />}
        {project.config.credentialEnabled && <SwitchField control={form.control} label={tFields('passwordEnabled')} name="passwordEnabled" />}
        {form.watch("passwordEnabled") && (
          props.type === 'edit' && !form.watch("password") && !form.watch("updatePassword") ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => form.setValue('updatePassword', true)}
            >
              {tFields('updatePassword')}
            </Button>
          ) : (
            <InputField
              control={form.control}
              label={props.type === 'edit' ? tFields('newPassword') : tFields('password')}
              name="password"
              type="password"
              autoComplete="off"
            />
          )
        )}
        {!form.watch("primaryEmailVerified") && form.watch("otpAuthEnabled") && <Typography variant="secondary">{tHints('emailVerifiedRequired')}</Typography>}

        <Accordion type="single" collapsible>
          <AccordionItem value="item-1">
            <AccordionTrigger>{tFields('metadata')}</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <TextAreaField rows={3} control={form.control} label={tFields('clientMetadata')} name="clientMetadata" placeholder="null" monospace />
              <TextAreaField rows={3} control={form.control} label={tFields('clientReadOnlyMetadata')} name="clientReadOnlyMetadata" placeholder="null" monospace />
              <TextAreaField rows={3} control={form.control} label={tFields('serverMetadata')} name="serverMetadata" placeholder="null" monospace />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </>
    )}
    onSubmit={handleSubmit}
    cancelButton
  />;
}
