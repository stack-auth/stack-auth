import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerUser } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { emailSchema, jsonStringOrEmptySchema, passwordSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Typography, useToast } from "@stackframe/stack-ui";
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
    primaryEmail: emailSchema.label("Primary email").defined().nonEmpty(),
    displayName: yup.string().optional(),
    signedUpAt: yup.date().defined(),
    clientMetadata: jsonStringOrEmptySchema.default("null"),
    clientReadOnlyMetadata: jsonStringOrEmptySchema.default("null"),
    serverMetadata: jsonStringOrEmptySchema.default("null"),
    primaryEmailVerified: yup.boolean().optional(),
    password: passwordSchema.min(1).test({
      name: 'password-required',
      message: "Password is required",
      test: (value, context) => {
        if (context.parent.passwordEnabled && (context.parent.updatePassword || props.type === 'create')) {
          return value != null;
        }
        return true;
      },
    }).optional(),
    otpAuthEnabled: yup.boolean().test({
      name: 'otp-verified',
      message: "Primary email must be verified if OTP/magic link sign-in is enabled",
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
      if (error instanceof KnownErrors.UserWithEmailAlreadyExists) {
        toast({
          title: "Email already exists",
          description: "Please choose a different email address",
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
    title={props.type === 'edit' ? "Edit User" : "Create User"}
    formSchema={formSchema}
    defaultValues={defaultValues}
    okButton={{ label: props.type === 'edit' ? "Save" : "Create" }}
    render={(form) => (
      <>
        {props.type === 'edit' ? <Typography variant='secondary'>ID: {props.user.id}</Typography> : null}

        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <InputField control={form.control} label="Primary email" name="primaryEmail" required />
          </div>
          <div className="mb-2">
            <SwitchField control={form.control} label="Verified" name="primaryEmailVerified" />
          </div>
        </div>

        <InputField control={form.control} label="Display name" name="displayName" />

        <DateField control={form.control} label="Signed Up At" name="signedUpAt" />

        {project.config.magicLinkEnabled && <SwitchField control={form.control} label="OTP/magic link sign-in" name="otpAuthEnabled" />}
        {project.config.credentialEnabled && <SwitchField control={form.control} label="Password sign-in" name="passwordEnabled" />}
        {form.watch("passwordEnabled") && (
          props.type === 'edit' && !form.watch("password") && !form.watch("updatePassword") ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => form.setValue('updatePassword', true)}
            >
              Update Password
            </Button>
          ) : (
            <InputField
              control={form.control}
              label={props.type === 'edit' ? "New password" : "Password"}
              name="password"
              type="password"
              autoComplete="off"
            />
          )
        )}
        {!form.watch("primaryEmailVerified") && form.watch("otpAuthEnabled") && <Typography variant="secondary">Primary email must be verified if OTP/magic link sign-in is enabled</Typography>}

        <Accordion type="single" collapsible>
          <AccordionItem value="item-1">
            <AccordionTrigger>Metadata</AccordionTrigger>
            <AccordionContent className="space-y-4">
              <TextAreaField rows={3} control={form.control} label="Client metadata" name="clientMetadata" placeholder="null" monospace />
              <TextAreaField rows={3} control={form.control} label="Client read only metadata" name="clientReadOnlyMetadata" placeholder="null" monospace />
              <TextAreaField rows={3} control={form.control} label="Server metadata" name="serverMetadata" placeholder="null" monospace />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </>
    )}
    onSubmit={handleSubmit}
    cancelButton
  />;
}
