"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { SettingCard, SettingText } from "@/components/settings";
import { getPublicEnvVar } from "@/lib/env";
import { AdminEmailConfig, AdminProject, AdminSentEmail } from "@stackframe/stack";
import { Reader } from "@stackframe/stack-emails/dist/editor/email-builder/index";
import { EMAIL_TEMPLATES_METADATA, convertEmailSubjectVariables, convertEmailTemplateMetadataExampleValues, convertEmailTemplateVariables, validateEmailTemplateContent } from "@stackframe/stack-emails/dist/utils";
import { EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, ActionDialog, Alert, AlertDescription, AlertTitle, Button, Card, DataTable, SimpleTooltip, Typography, useToast } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;
  const emailTemplates = stackAdminApp.useEmailTemplates();
  const router = useRouter();
  const [resetTemplateType, setResetTemplateType] = useState<EmailTemplateType>("email_verification");
  const [resetTemplateDialogOpen, setResetTemplateDialogOpen] = useState(false);
  const [sharedSmtpWarningDialogOpen, setSharedSmtpWarningDialogOpen] = useState<EmailTemplateType|null>(null);

  return (
    <PageLayout title="Emails" description="Configure email settings for your project">
      {getPublicEnvVar('NEXT_PUBLIC_STACK_EMULATOR_ENABLED') === 'true' ? (
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
      ) : (
        <SettingCard
          title="Email Server"
          description="Configure the email server and sender address for outgoing emails"
          actions={
            <div className="flex items-center gap-2">
              {emailConfig?.type === 'standard' && <TestSendingDialog trigger={<Button variant='secondary' className="w-full">Send Test Email</Button>} />}
              <EditEmailServerDialog trigger={<Button variant='secondary' className="w-full">Configure</Button>} />
            </div>
          }
        >
          <SettingText label="Server">
            <div className="flex items-center gap-2">
              { emailConfig?.type === 'standard' ?
                'Custom SMTP server' :
                <>Shared <SimpleTooltip tooltip="When you use the shared email server, all the emails are sent from Stack's email address" type='info' /></>
              }
            </div>
          </SettingText>
          <SettingText label="Sender Email">
            {emailConfig?.type === 'standard' ? emailConfig.senderEmail : 'noreply@stackframe.co'}
          </SettingText>
        </SettingCard>
      )}

      <SettingCard title="Email Templates" description="Customize the emails sent">
        {emailConfig?.type === 'shared' && <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
          </AlertDescription>
        </Alert>}
        {emailTemplates.map((template) => (
          <Card key={template.type} className="p-4 flex justify-between flex-col sm:flex-row gap-4">
            <div className="flex flex-col gap-2">
              <div>
                <Typography className="font-medium">
                  {EMAIL_TEMPLATES_METADATA[template.type].label}
                </Typography>
                <Typography type='label' variant='secondary'>
                  Subject: <SubjectPreview subject={template.subject} type={template.type} />
                </Typography>
              </div>
              <div className="flex-grow flex justify-start items-end gap-2">
                <Button variant='secondary' onClick={() => {
                  if (emailConfig?.type === 'shared') {
                    setSharedSmtpWarningDialogOpen(template.type);
                  } else {
                    router.push(`emails/templates/${template.type}`);
                  }
                }}>Edit Template</Button>
                {!template.isDefault && <ActionCell
                  items={[{
                    item: 'Reset to Default',
                    danger: true,
                    onClick: () => {
                      setResetTemplateType(template.type);
                      setResetTemplateDialogOpen(true);
                    }
                  }]}
                />}
              </div>
            </div>
            <EmailPreview content={template.content} type={template.type} />
          </Card>
        ))}
      </SettingCard>
      <SettingCard title="Email Log" description="Manage email sending history">
        <EmailSendDataTable />
      </SettingCard>

      <ActionDialog
        open={sharedSmtpWarningDialogOpen !== null}
        onClose={() => setSharedSmtpWarningDialogOpen(null)}
        title="Shared Email Server"
        okButton={{ label: "Edit Templates Anyway", onClick: async () => {
          router.push(`emails/templates/${sharedSmtpWarningDialogOpen}`);
        } }}
        cancelButton={{ label: "Cancel" }}
      >
        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. If you want to customize the email templates, you need to configure a custom SMTP server.
            You can edit the templates anyway, but you will not be able to save them.
          </AlertDescription>
        </Alert>
      </ActionDialog>
    </PageLayout>
  );
}


const emailTableColumns: ColumnDef<AdminSentEmail>[] = [
  { accessorKey: 'recipient', header: 'Recipient' },
  { accessorKey: 'subject', header: 'Subject' },
  { accessorKey: 'sentAt', header: 'Sent At', cell: ({ row }) => {
    const date = row.original.sentAt;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
  },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => {
    return row.original.error ? (
      <div className="text-red-500">Failed</div>
    ) : (
      <div className="text-green-500">Sent</div>
    );
  } },
];

function EmailSendDataTable() {
  const stackAdminApp = useAdminApp();
  const [emailLogs, setEmailLogs] = useState<AdminSentEmail[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch email logs when component mounts
  useEffect(() => {
    runAsynchronously(async () => {
      setLoading(true);
      try {
        const emails = await stackAdminApp.listSentEmails();
        setEmailLogs(emails);
      } finally {
        setLoading(false);
      }
    });
  }, [stackAdminApp]);

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Typography>Loading email logs...</Typography>
      </div>
    );
  }

  return <DataTable
    data={emailLogs}
    defaultColumnFilters={[]}
    columns={emailTableColumns}
    defaultSorting={[{ id: 'sentAt', desc: true }]}
  />;
}

function EmailPreview(props: { content: any, type: EmailTemplateType }) {
  const project = useAdminApp().useProject();
  const [valid, document] = useMemo(() => {
    const valid = validateEmailTemplateContent(props.content);
    if (!valid) return [false, null];

    const metadata = convertEmailTemplateMetadataExampleValues(EMAIL_TEMPLATES_METADATA[props.type], project.displayName);
    const document = convertEmailTemplateVariables(props.content, metadata.variables);
    return [true, document];
  }, [props.content, props.type, project]);

  let reader;
  if (valid && document) {
    reader = (
      <div className="scale-50 w-[400px] origin-top-left">
        <Reader document={document} rootBlockId='root' />
      </div>
    );
  } else {
    reader = <div className="flex items-center justify-center h-full text-red-500">Invalid template</div>;
  }

  return (
    <div className="max-h-[150px] min-h-[150px] max-w-[200px] sm:min-w-[200px] overflow-hidden rounded border" inert=''>
      <div className="absolute inset-0 bg-transparent z-10"/>
      {reader}
    </div>
  );
}

function SubjectPreview(props: { subject: string, type: EmailTemplateType }) {
  const project = useAdminApp().useProject();
  const subject = useMemo(() => {
    const metadata = convertEmailTemplateMetadataExampleValues(EMAIL_TEMPLATES_METADATA[props.type], project.displayName);
    return convertEmailSubjectVariables(props.subject, metadata.variables);
  }, [props.subject, props.type, project]);
  return subject;
}

function definedWhenNotShared<S extends yup.AnyObject>(schema: S, message: string): S {
  return schema.when('type', {
    is: 'standard',
    then: (schema: S) => schema.defined(message),
    otherwise: (schema: S) => schema.optional()
  });
}

const getDefaultValues = (emailConfig: AdminEmailConfig | undefined, project: AdminProject) => {
  if (!emailConfig) {
    return { type: 'shared', senderName: project.displayName } as const;
  } else if (emailConfig.type === 'shared') {
    return { type: 'shared' } as const;
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
  type: yup.string().oneOf(['shared', 'standard']).defined(),
  host: definedWhenNotShared(yup.string(), "Host is required"),
  port: definedWhenNotShared(yup.number().min(0, "Port must be a number between 0 and 65535").max(65535, "Port must be a number between 0 and 65535"), "Port is required"),
  username: definedWhenNotShared(yup.string(), "Username is required"),
  password: definedWhenNotShared(yup.string(), "Password is required"),
  senderEmail: definedWhenNotShared(strictEmailSchema("Sender email must be a valid email"), "Sender email is required"),
  senderName: definedWhenNotShared(yup.string(), "Email sender name is required"),
});

function EditEmailServerDialog(props: {
  trigger: React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const [error, setError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<any>(null);
  const defaultValues = useMemo(() => getDefaultValues(project.config.emailConfig, project), [project]);
  const { toast } = useToast();

  return <FormDialog
    trigger={props.trigger}
    title="Edit Email Server"
    formSchema={emailServerSchema}
    defaultValues={defaultValues}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      if (values.type === 'shared') {
        await project.update({
          config: {
            emailConfig: { type: 'shared' }
          }
        });
      } else {
        if (!values.host || !values.port || !values.username || !values.password || !values.senderEmail || !values.senderName) {
          throwErr("Missing email server config for custom SMTP server");
        }

        const emailConfig = {
          host: values.host,
          port: values.port,
          username: values.username,
          password: values.password,
          senderEmail: values.senderEmail,
          senderName: values.senderName,
        };

        const testResult = await stackAdminApp.sendTestEmail({
          recipientEmail: 'test-email-recipient@stackframe.co',
          emailConfig: emailConfig,
        });

        if (testResult.status === 'error') {
          setError(testResult.error.errorMessage);
          return 'prevent-close-and-prevent-reset';
        } else {
          setError(null);
        }

        await project.update({
          config: {
            emailConfig: {
              type: 'standard',
              ...emailConfig,
            }
          }
        });

        toast({
          title: "Email server updated",
          description: "The email server has been updated. You can now send test emails to verify the configuration.",
          variant: 'success',
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
            { label: "Custom SMTP server (your own email address)", value: 'standard' },
          ]}
        />
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
      const emailConfig = project.config.emailConfig || throwErr("Email config is not set");
      if (emailConfig.type === 'shared') throwErr("Shared email server cannot be used for testing");

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
        <InputField label="Email" name="email" control={form.control} type="email" autoComplete="email" required/>
        {error && <Alert variant="destructive">{error}</Alert>}
      </>
    )}
  />;
}

function ResetEmailTemplateDialog(props: {
  open?: boolean,
  onClose?: () => void,
  templateType: EmailTemplateType,
}) {
  const stackAdminApp = useAdminApp();
  return <ActionDialog
    danger
    open={props.open}
    onClose={props.onClose}
    title="Reset Email Template"
    okButton={{
      label: "Reset",
      onClick: async () => { await stackAdminApp.resetEmailTemplate(props.templateType); }
    }}
    confirmText="I understand this cannot be undone"
  >
    Are you sure you want to reset the email template to the default? You will lose all the changes you have made.
  </ActionDialog>;
}
