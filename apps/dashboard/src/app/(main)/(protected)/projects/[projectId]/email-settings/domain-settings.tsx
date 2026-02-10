"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { SettingCard } from "@/components/settings";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { AdminEmailConfig, AdminProject } from "@stackframe/stack";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Alert, Button, Form, Input, Label, Typography, useToast } from "@/components/ui";
import { useCallback, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { useAdminApp } from "../use-admin-app";

function definedWhenTypeIsOneOf<S extends yup.AnyObject>(schema: S, types: string[], message: string): S {
  return schema.when('type', {
    is: (t: string) => types.includes(t),
    then: (schema: S) => schema.defined(message),
    otherwise: (schema: S) => schema.optional()
  });
}

const getDefaultValues = (emailConfig: CompleteConfig['emails']['server'] | undefined, project: AdminProject) => {
  if (!emailConfig) {
    return { type: 'shared', senderName: project.displayName } as const;
  } else if (emailConfig.isShared) {
    return { type: 'shared' } as const;
  } else if (emailConfig.provider === 'resend') {
    return {
      type: 'resend',
      senderEmail: emailConfig.senderEmail,
      senderName: emailConfig.senderName,
      password: emailConfig.password,
    } as const;
  } else {
    return {
      type: 'standard',
      senderName: emailConfig.senderName,
      host: emailConfig.host,
      port: emailConfig.port,
      username: emailConfig.username,
      password: emailConfig.password,
      senderEmail: emailConfig.senderEmail,
    } as const;
  }
};

const emailServerSchema = yup.object({
  type: yup.string().oneOf(['shared', 'standard', 'resend']).defined(),
  host: definedWhenTypeIsOneOf(yup.string(), ["standard"], "Host is required"),
  port: definedWhenTypeIsOneOf(yup.number().min(0, "Port must be a number between 0 and 65535").max(65535, "Port must be a number between 0 and 65535"), ["standard"], "Port is required"),
  username: definedWhenTypeIsOneOf(yup.string(), ["standard"], "Username is required"),
  password: definedWhenTypeIsOneOf(yup.string(), ["standard", "resend"], "Password is required"),
  senderEmail: definedWhenTypeIsOneOf(strictEmailSchema("Sender email must be a valid email"), ["standard", "resend"], "Sender email is required"),
  senderName: definedWhenTypeIsOneOf(yup.string(), ["standard", "resend"], "Email sender name is required"),
});

function EditEmailServerDialog(props: {
  trigger: React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const [error, setError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<any>(null);
  const defaultValues = useMemo(() => getDefaultValues(config.emails.server, project), [config, project]);
  const { toast } = useToast();

  async function testEmailAndUpdateConfig(emailConfig: AdminEmailConfig & { type: "standard" | "resend" }) {
    const testResult = await stackAdminApp.sendTestEmail({
      recipientEmail: 'test-email-recipient@stackframe.co',
      emailConfig,
    });

    if (testResult.status === 'error') {
      setError(testResult.error.errorMessage);
      return 'prevent-close-and-prevent-reset';
    }
    setError(null);
    // Email server config contains secrets, so it's environment-level only (pushable: false)
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        "emails.server": {
          isShared: false,
          host: emailConfig.host,
          port: emailConfig.port,
          username: emailConfig.username,
          password: emailConfig.password,
          senderEmail: emailConfig.senderEmail,
          senderName: emailConfig.senderName,
          provider: emailConfig.type === 'resend' ? 'resend' : 'smtp',
        } satisfies CompleteConfig['emails']['server']
      },
      pushable: false,
    });

    toast({
      title: "Email server updated",
      description: "The email server has been updated. You can now send test emails to verify the configuration.",
      variant: 'success',
    });
  }

  return <FormDialog
    trigger={props.trigger}
    title="Edit Email Server"
    formSchema={emailServerSchema}
    defaultValues={defaultValues}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      if (values.type === 'shared') {
        // Email server config contains secrets, so it's environment-level only (pushable: false)
        await updateConfig({
          adminApp: stackAdminApp,
          configUpdate: {
            "emails.server": {
              isShared: true,
            } satisfies Partial<CompleteConfig['emails']['server']>
          },
          pushable: false,
        });
      } else if (values.type === 'resend') {
        if (!values.password || !values.senderEmail || !values.senderName) {
          throwErr("Missing email server config for Resend");
        }
        return await testEmailAndUpdateConfig({
          type: 'resend',
          host: 'smtp.resend.com',
          port: 465,
          username: 'resend',
          password: values.password,
          senderEmail: values.senderEmail,
          senderName: values.senderName,
        });
      } else {
        if (!values.host || !values.port || !values.username || !values.password || !values.senderEmail || !values.senderName) {
          throwErr("Missing email server config for custom SMTP server");
        }
        return await testEmailAndUpdateConfig({
          type: 'standard',
          host: values.host,
          port: values.port,
          username: values.username,
          password: values.password,
          senderEmail: values.senderEmail,
          senderName: values.senderName
        });
      }
    }}
    cancelButton
    onFormChange={(form) => {
      const values = form.getValues();
      if (!deepPlainEquals(values, formValues)) {
        setFormValues(values);
        setError(null);
      }
    }}
    render={(form) => (
      <>
        <SelectField
          label="Email server"
          name="type"
          control={form.control}
          options={[
            { label: "Shared (noreply@stackframe.co)", value: 'shared' },
            { label: "Resend (your own email address)", value: 'resend' },
            { label: "Custom SMTP server (your own email address)", value: 'standard' },
          ]}
        />
        {form.watch('type') === 'resend' && <>
          {([
            { label: "Resend API Key", name: "password", type: 'password' },
            { label: "Sender Email", name: "senderEmail", type: 'email' },
            { label: "Sender Name", name: "senderName", type: 'text' },
          ] as const).map((field) => (
            <InputField
              key={field.name}
              label={field.label}
              name={field.name}
              control={form.control}
              type={field.type}
              required
            />
          ))}
        </>}
        {form.watch('type') === 'standard' && <>
          {([
            { label: "Host", name: "host", type: 'text' },
            { label: "Port", name: "port", type: 'number' },
            { label: "Username", name: "username", type: 'text' },
            { label: "Password", name: "password", type: 'password' },
            { label: "Sender Email", name: "senderEmail", type: 'email' },
            { label: "Sender Name", name: "senderName", type: 'text' },
          ] as const).map((field) => (
            <InputField
              key={field.name}
              label={field.label}
              name={field.name}
              control={form.control}
              type={field.type}
              required
            />
          ))}
        </>}
        {error && <Alert variant="destructive">{error}</Alert>}
      </>
    )}
  />;
}

// Schema for inline sender editing
const senderSchema = yup.object({
  senderEmail: strictEmailSchema("Sender email must be a valid email").defined(),
  senderName: yup.string().defined(),
});

type SenderFormValues = yup.InferType<typeof senderSchema>;

// Inline editable sender information component
function SenderInlineForm(props: {
  defaultValues: SenderFormValues,
  onSubmit: (values: SenderFormValues) => Promise<void>,
}) {
  const formId = useId();
  const form = useForm<SenderFormValues>({
    resolver: yupResolver(senderSchema),
    defaultValues: props.defaultValues,
    mode: "onChange",
  });
  const [submitting, setSubmitting] = useState(false);
  const buttonsDisabled = submitting || !form.formState.isDirty;
  const { toast } = useToast();

  const onSubmit = useCallback(async (values: SenderFormValues) => {
    setSubmitting(true);
    try {
      await props.onSubmit(values);
      form.reset(values);
      toast({ title: 'Sender information updated', variant: 'success' });
    } finally {
      setSubmitting(false);
    }
  }, [props, form, toast]);

  const handleFormSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    runAsynchronouslyWithAlert(form.handleSubmit(onSubmit)());
  }, [form, onSubmit]);

  const handleCancel = useCallback(() => {
    form.reset();
  }, [form]);

  return (
    <Form {...form}>
      <form onSubmit={handleFormSubmit} className="space-y-4 max-w-md" id={formId}>
        <InputField
          label="Sender Email"
          name="senderEmail"
          control={form.control}
          type="email"
          required
        />
        <InputField
          label="Sender Name"
          name="senderName"
          control={form.control}
          type="text"
          required
        />
        {form.formState.isDirty && (
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              onClick={handleCancel}
              variant="secondary"
              size="sm"
              disabled={buttonsDisabled}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={submitting}
              disabled={buttonsDisabled}
            >
              Save
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}

function TestSendingDialog(props: {
  trigger: React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  return <FormDialog
    trigger={props.trigger}
    title="Send a Test Email"
    formSchema={yup.object({
      email: yup.string().email().defined().label("Recipient email address")
    })}
    okButton={{ label: "Send" }}
    onSubmit={async (values) => {
      const emailConfig = project.config.emailConfig ?? throwErr("Email config is not set");
      if (emailConfig.type === 'shared') {
        throwErr("Shared email server cannot be used for testing");
      }

      const result = await stackAdminApp.sendTestEmail({
        recipientEmail: values.email,
        emailConfig: emailConfig,
      });

      if (result.status === 'ok') {
        toast({
          title: "Email sent",
          description: `The test email has been sent to ${values.email}. Please check your inbox.`,
          variant: 'success',
        });
      } else {
        setError(result.error.errorMessage);
        return 'prevent-close';
      }
    }}
    cancelButton
    onFormChange={(form) => {
      if (form.getValues('email')) {
        setError(null);
      }
    }}
    render={(form) => (
      <>
        <InputField label="Email" name="email" control={form.control} type="email" autoComplete="email" required />
        {error && <Alert variant="destructive">{error}</Alert>}
      </>
    )}
  />;
}

// Helper to mask sensitive values
function maskSecret(value: string): string {
  if (value.length <= 4) return "••••";
  return "••••••••" + value.slice(-4);
}

export function DomainSettings() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;
  const updateConfig = useUpdateConfig();

  // In emulator mode, show mock emails UI
  if (getPublicEnvVar('NEXT_PUBLIC_STACK_EMULATOR_ENABLED') === 'true') {
    return (
      <SettingCard
        title="Mock Emails"
        description="View all emails sent through the emulator in Inbucket"
      >
        <Button variant='secondary' onClick={() => {
          window.open(getPublicEnvVar('NEXT_PUBLIC_STACK_INBUCKET_WEB_URL') + '/monitor', '_blank');
        }}>
          Open Inbox
        </Button>
      </SettingCard>
    );
  }

  const isShared = emailConfig.isShared;
  const serverType = isShared
    ? 'Shared'
    : (emailConfig.provider === 'resend' ? 'Resend' : 'Custom SMTP');

  // Get server details for accordion (only for non-shared)
  const serverDetails = !isShared ? {
    host: emailConfig.host,
    port: emailConfig.port,
    username: emailConfig.username,
    password: emailConfig.password,
  } : null;

  const handleSenderSubmit = async (values: SenderFormValues) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        "emails.server.senderEmail": values.senderEmail,
        "emails.server.senderName": values.senderName,
      },
      pushable: false,
    });
  };

  return (
    <SettingCard>
      {/* Custom header with buttons aligned to title */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <Typography type="h3" className="font-semibold">Email Server Configuration</Typography>
          <Typography variant="secondary" className="text-sm mt-1">
            Using {serverType === 'Shared' ? 'Stack Auth shared server' : serverType}
          </Typography>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isShared && (
            <TestSendingDialog trigger={<Button variant="outline" size="sm">Send Test Email</Button>} />
          )}
          <EditEmailServerDialog trigger={
            <Button size="sm" variant="outline" className="gap-1.5">
              <span>Configure</span>
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Button>
          } />
        </div>
      </div>

      {/* Sender Information - Inline Editable for non-shared, read-only for shared */}
      {isShared ? (
        <div className="space-y-3 mb-4">
          <div>
            <Label className="text-sm font-medium">Sender Email</Label>
            <Typography className="text-sm text-muted-foreground">noreply@stackframe.co</Typography>
          </div>
          <div>
            <Label className="text-sm font-medium">Sender Name</Label>
            <Typography className="text-sm text-muted-foreground">{project.displayName}</Typography>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <SenderInlineForm
            defaultValues={{
              senderEmail: emailConfig.senderEmail ?? "",
              senderName: emailConfig.senderName ?? "",
            }}
            onSubmit={handleSenderSubmit}
          />
        </div>
      )}

      {/* Server Details Accordion - Only for non-shared servers */}
      {serverDetails && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="server-details" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-medium">
              Server Details
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-2 max-w-md">
                <div>
                  <Label className="text-xs text-muted-foreground">Host</Label>
                  <Input value={serverDetails.host} disabled className="bg-muted/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <Input value={String(serverDetails.port)} disabled className="bg-muted/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <Input value={serverDetails.username} disabled className="bg-muted/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Password</Label>
                  <Input value={serverDetails.password ? maskSecret(serverDetails.password) : "••••"} disabled className="bg-muted/50" type="password" />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </SettingCard>
  );
}
