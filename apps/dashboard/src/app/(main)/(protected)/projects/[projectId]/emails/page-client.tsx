"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField, TextAreaField } from "@/components/form-fields";
import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import { SettingCard, SettingText } from "@/components/settings";
import { getPublicEnvVar } from "@/lib/env";
import { AdminEmailConfig, AdminProject, AdminSentEmail, ServerUser, UserAvatar } from "@stackframe/stack";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Alert, Button, DataTable, SimpleTooltip, Typography, useToast, Input, Textarea, TooltipProvider, TooltipTrigger, TooltipContent, Tooltip, AlertDescription, AlertTitle } from "@stackframe/stack-ui";
import { ColumnDef } from "@tanstack/react-table";
import { AlertCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.config.emailConfig;

  return (
    <PageLayout
      title="Emails"
      description="Manage email server and logs"
      actions={
        <SendEmailDialog
          trigger={<Button>Send Email</Button>}
          emailConfigType={emailConfig?.type}
        />
      }
    >
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
              {emailConfig?.type === 'standard' ?
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
      <SettingCard title="Email Log" description="Manage email sending history" >
        <EmailSendDataTable />
      </SettingCard>
    </PageLayout>
  );
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
        <InputField label="Email" name="email" control={form.control} type="email" autoComplete="email" required />
        {error && <Alert variant="destructive">{error}</Alert>}
      </>
    )}
  />;
}

const emailTableColumns: ColumnDef<AdminSentEmail>[] = [
  { accessorKey: 'recipient', header: 'Recipient' },
  { accessorKey: 'subject', header: 'Subject' },
  {
    accessorKey: 'sentAt', header: 'Sent At', cell: ({ row }) => {
      const date = row.original.sentAt;
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
  },
  {
    accessorKey: 'status', header: 'Status', cell: ({ row }) => {
      return row.original.error ? (
        <div className="text-red-500">Failed</div>
      ) : (
        <div className="text-green-500">Sent</div>
      );
    }
  },
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

function SendEmailDialog(props: {
  trigger: React.ReactNode,
  emailConfigType?: AdminEmailConfig['type'],
}) {
  const stackAdminApp = useAdminApp();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sharedSmtpDialogOpen, setSharedSmtpDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ServerUser | null>(null);

  const handleSend = async (formData: { subject: string, content: string, notificationCategoryName: string }) => {
    if (!selectedUser) {
      toast({
        title: "No recipients selected",
        description: "Please select at least one recipient to send the email.",
        variant: "destructive",
      });
      return "prevent-close-and-prevent-reset";
    }
    try {
      await stackAdminApp.sendEmail({
        userId: selectedUser.id,
        subject: formData.subject,
        content: formData.content,
        notificationCategoryName: formData.notificationCategoryName,
      });
    } catch (error) {
      toast({
        title: "Error sending email",
        description: "The email could not be sent. The user may have unsubscribed from this notification category.",
        variant: "destructive",
      });
      return;
    }
    setSelectedUser(null);
    toast({
      title: "Email sent",
      description: "Email was successfully sent.",
      variant: 'success',
    });
  };

  return (
    <>
      <div
        onClick={() => {
          if (props.emailConfigType === 'standard') {
            setOpen(true);
          } else {
            setSharedSmtpDialogOpen(true);
          }
        }}
      >
        {props.trigger}
      </div>
      <ActionDialog
        open={sharedSmtpDialogOpen}
        onClose={() => setSharedSmtpDialogOpen(false)}
        title="Shared Email Server"
        okButton
      >
        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. If you want to send manual emails, you need to configure a custom SMTP server.
          </AlertDescription>
        </Alert>
      </ActionDialog>
      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Send Email"
        cancelButton
        okButton={{ label: "Send" }}
        onSubmit={handleSend}
        formSchema={yup.object({
          subject: yup.string().defined(),
          content: yup.string().defined(),
          notificationCategoryName: yup.string().oneOf(['Transactional', 'Marketing']).label("notification category").defined(),
        })}
        render={(form) => (
          <>
            <div className="mb-4">
              <Typography className="font-medium mb-2">Recipient</Typography>
              <TooltipProvider>
                <div className="flex flex-wrap gap-2 mb-4">
                  {selectedUser && (
                    <Tooltip key={selectedUser.id}>
                      <TooltipTrigger>
                        <UserAvatar user={selectedUser} size={32} />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <div className="max-w-60 text-center text-wrap whitespace-pre-wrap">
                          {selectedUser.primaryEmail}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TooltipProvider>
              <TeamMemberSearchTable
                action={(user) => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedUser(user)}
                    disabled={selectedUser?.id === user.id}
                  >
                    {selectedUser?.id === user.id ? 'Selected' : 'Select'}
                  </Button>
                )}
              />
            </div>
            <InputField label="Subject" name="subject" control={form.control} type="text" required />
            {/* TODO: fetch notification categories here instead of hardcoding these two */}
            <SelectField
              label="Notification Category"
              name="notificationCategoryName"
              control={form.control}
              options={[
                { label: "Transactional", value: 'Transactional' },
                { label: "Marketing", value: 'Marketing' },
              ]}
            />
            <TextAreaField
              label="Email Content"
              name="content"
              control={form.control}
              rows={10}
              required
            />
          </>
        )}
      />
    </>
  );
}
