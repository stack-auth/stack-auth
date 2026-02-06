"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { SettingCard, SettingText } from "@/components/settings";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { AdminEmailConfig, AdminProject } from "@stackframe/stack";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { Alert, Button, useToast } from "@/components/ui";
import { useMemo, useState } from "react";
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

function EditSenderDialog(props: {
  trigger: React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const { toast } = useToast();

  const emailConfig = config.emails.server;
  if (emailConfig.isShared) {
    throwErr("Cannot edit sender for shared email server");
  }

  const defaultValues = {
    senderEmail: emailConfig.senderEmail,
    senderName: emailConfig.senderName,
  };

  return <FormDialog
    trigger={props.trigger}
    title="Edit Sender"
    formSchema={yup.object({
      senderEmail: strictEmailSchema("Sender email must be a valid email").defined().label("Sender Email"),
      senderName: yup.string().defined().label("Sender Name"),
    })}
    defaultValues={defaultValues}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: {
          "emails.server.senderEmail": values.senderEmail,
          "emails.server.senderName": values.senderName,
        },
        pushable: false,
      });

      toast({
        title: "Sender updated",
        description: "The sender email and name have been updated.",
        variant: 'success',
      });
    }}
    cancelButton
    render={(form) => (
      <>
        <InputField label="Sender Email" name="senderEmail" control={form.control} type="email" required />
        <InputField label="Sender Name" name="senderName" control={form.control} type="text" required />
      </>
    )}
  />;
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

export function DomainSettings() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;

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

  const senderEmail = emailConfig.isShared ? 'noreply@stackframe.co' : emailConfig.senderEmail;
  const serverType = emailConfig.isShared 
    ? 'Shared' 
    : (emailConfig.provider === 'resend' ? 'Resend' : 'Custom SMTP');

  return (
    <SettingCard title="Domain Settings">
      <div className="flex items-start justify-between">
        <SettingText label="Sender's address">
          {senderEmail}
        </SettingText>
        {!emailConfig.isShared && (
          <EditSenderDialog trigger={<Button variant="ghost" size="sm">Edit</Button>} />
        )}
      </div>

      <SettingText label="Email Server Type">
        {serverType}
      </SettingText>

      {/* Bottom: Buttons */}
      <div className="flex items-center justify-end gap-2 pt-4">
        {!emailConfig.isShared && (
          <TestSendingDialog trigger={<Button variant="outline" size="sm">Send Test Email</Button>} />
        )}
        <EditEmailServerDialog trigger={
          <Button size="sm" variant="outline" className="gap-1.5">
            <span>Configure</span>
            <ArrowRightIcon className="h-3.5 w-3.5" />
          </Button>
        } />
      </div>
    </SettingCard>
  );
}
