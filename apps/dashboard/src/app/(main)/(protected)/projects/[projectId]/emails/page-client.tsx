"use client";

import { TeamMemberSearchTable } from "@/components/data-table/team-member-search-table";
import { FormDialog } from "@/components/form-dialog";
import { InputField, SelectField, TextAreaField } from "@/components/form-fields";
import { ActionDialog, Alert, AlertDescription, AlertTitle, Button, DataTable, DataTableColumnHeader, DataTableViewOptions, SimpleTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Typography, useToast } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { cn } from "@/lib/utils";
import { CheckCircle, Envelope, HardDrive, Sliders, WarningCircleIcon, XCircle, XIcon } from "@phosphor-icons/react";
import { AdminEmailConfig, AdminProject, AdminSentEmail, ServerUser, UserAvatar } from "@stackframe/stack";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals } from "@stackframe/stack-shared/dist/utils/objects";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef, Table as TableType } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

// Glassmorphic card component following design guide
function GlassCard({
  children,
  className,
  gradientColor = "blue"
}: {
  children: React.ReactNode,
  className?: string,
  gradientColor?: "blue" | "purple" | "green" | "orange" | "slate" | "cyan",
}) {
  const hoverTints: Record<string, string> = {
    blue: "group-hover:bg-blue-500/[0.03]",
    purple: "group-hover:bg-purple-500/[0.03]",
    green: "group-hover:bg-emerald-500/[0.03]",
    orange: "group-hover:bg-orange-500/[0.03]",
    slate: "group-hover:bg-slate-500/[0.02]",
    cyan: "group-hover:bg-cyan-500/[0.03]",
  };

  return (
    <div className={cn(
      "group relative rounded-2xl bg-background/60 backdrop-blur-xl transition-all duration-150 hover:transition-none",
      "ring-1 ring-foreground/[0.06] hover:ring-foreground/[0.1]",
      "shadow-sm hover:shadow-md",
      className
    )}>
      {/* Subtle glassmorphic background */}
      <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.02] to-transparent pointer-events-none rounded-2xl overflow-hidden" />
      {/* Accent hover tint */}
      <div className={cn(
        "absolute inset-0 transition-colors duration-150 group-hover:transition-none pointer-events-none rounded-2xl overflow-hidden",
        hoverTints[gradientColor]
      )} />
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

// Section header with icon following design guide
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType, title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="p-1.5 rounded-lg bg-foreground/[0.04]">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}

// Status badge component
function StatusBadge({ status, error }: { status: 'sent' | 'failed', error?: string | null }) {
  if (status === 'sent') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-500/20">
        <CheckCircle className="h-3 w-3" />
        Sent
      </div>
    );
  }
  return (
    <SimpleTooltip tooltip={error || 'Email delivery failed'}>
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-red-600 dark:text-red-400 bg-red-500/10 ring-1 ring-red-500/20">
        <XCircle className="h-3 w-3" />
        Failed
      </div>
    </SimpleTooltip>
  );
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Emails"
        description="Manage email server configuration and view sending history"
        actions={
          <SendEmailDialog
            trigger={
              <Button className="gap-2">
                <Envelope className="h-4 w-4" />
                Send Email
              </Button>
            }
            emailConfig={emailConfig}
          />
        }
      >
        <div className="flex flex-col gap-5">
          {/* Email Server Card */}
          <EmailServerCard emailConfig={emailConfig} />

          {/* Email Log Card */}
          <EmailLogCard />
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

function EmailServerCard({ emailConfig }: { emailConfig: CompleteConfig['emails']['server'] }) {
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  const serverType = emailConfig.isShared
    ? 'Shared'
    : (emailConfig.provider === 'resend' ? 'Resend' : 'Custom SMTP');

  const senderEmail = emailConfig.isShared
    ? 'noreply@stackframe.co'
    : emailConfig.senderEmail;

  return (
    <GlassCard gradientColor="slate">
      <div className="p-5">
        <div className="flex items-start justify-between gap-5">
          <div className="flex-1 min-w-0">
            <SectionHeader icon={HardDrive} title="Email Server" />
            <Typography variant="secondary" className="text-sm mt-1">
              {isLocalEmulator
                ? "Email server settings are read-only in the local emulator"
                : "Configure the email server and sender address for outgoing emails"}
            </Typography>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!emailConfig.isShared && !isLocalEmulator && (
              <TestSendingDialog
                trigger={
                  <Button variant='ghost' size="sm" className="h-8 px-3 text-xs gap-1.5">
                    <Envelope className="h-3.5 w-3.5" />
                    Test
                  </Button>
                }
              />
            )}
            {!isLocalEmulator ? (
              <EditEmailServerDialog
                trigger={
                  <Button variant='secondary' size="sm" className="h-8 px-3 text-xs gap-1.5">
                    <Sliders className="h-3.5 w-3.5" />
                    Configure
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>
        {isLocalEmulator && (
          <Alert className="mt-4">
            <AlertDescription>
              Email server settings cannot be changed in the local emulator. Update these settings in your production deployment.
            </AlertDescription>
          </Alert>
        )}
      </div>
      <div className="border-t border-foreground/[0.05] px-5 pb-5 pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Server Type */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Server
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{serverType}</span>
              {emailConfig.isShared && (
                <SimpleTooltip tooltip="When you use the shared email server, all the emails are sent from Stack's email address" type='info' />
              )}
            </div>
          </div>

          {/* Sender Email */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Sender Email
            </span>
            <span className="text-sm font-medium text-foreground font-mono">{senderEmail}</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function EmailLogCard() {
  const stackAdminApp = useAdminApp();
  const [emailLogs, setEmailLogs] = useState<AdminSentEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<TableType<AdminSentEmail> | null>(null);

  // Fetch email logs when component mounts
  useEffect(() => {
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      setLoading(true);
      setError(null);
      const emails = await stackAdminApp.listSentEmails();
      if (cancelled) return;
      setEmailLogs(emails);
      setLoading(false);
    }, {
      onError: (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load email logs");
        setLoading(false);
      },
    });
    return () => {
      cancelled = true;
    };
  }, [stackAdminApp]);

  if (loading) {
    return (
      <GlassCard gradientColor="slate" className="overflow-hidden">
        <div className="p-5">
          <SectionHeader icon={Envelope} title="Email Log" />
          <Typography variant="secondary" className="text-sm mt-1">
            View and manage email sending history
          </Typography>
        </div>
        <div className="border-t border-foreground/[0.05] flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 rounded-xl bg-foreground/[0.04]">
              <Envelope className="h-5 w-5 text-muted-foreground/50 animate-pulse" />
            </div>
            <Typography variant="secondary" className="text-sm">
              Loading email logs...
            </Typography>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard gradientColor="slate" className="overflow-hidden">
        <div className="p-5">
          <SectionHeader icon={Envelope} title="Email Log" />
          <Typography variant="secondary" className="text-sm mt-1">
            View and manage email sending history
          </Typography>
        </div>
        <div className="border-t border-foreground/[0.05] flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <div className="p-3 rounded-xl bg-destructive/10">
              <Envelope className="h-5 w-5 text-destructive" />
            </div>
            <div className="space-y-1">
              <Typography className="text-sm font-medium text-foreground">Failed to load emails</Typography>
              <Typography variant="secondary" className="text-sm">
                {error}
              </Typography>
            </div>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (emailLogs.length === 0) {
    return (
      <GlassCard gradientColor="slate" className="overflow-hidden">
        <div className="p-5">
          <SectionHeader icon={Envelope} title="Email Log" />
          <Typography variant="secondary" className="text-sm mt-1">
            View and manage email sending history
          </Typography>
        </div>
        <div className="border-t border-foreground/[0.05] flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm">
            <div className="p-3 rounded-xl bg-foreground/[0.04]">
              <Envelope className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <div className="space-y-1">
              <Typography className="text-sm font-medium text-foreground">No emails sent yet</Typography>
              <Typography variant="secondary" className="text-sm">
                Emails will appear here once sent
              </Typography>
            </div>
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard gradientColor="slate" className="overflow-hidden">
      <div className="p-5">
        <div className="flex w-full items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <SectionHeader icon={Envelope} title="Email Log" />
            <Typography variant="secondary" className="text-sm mt-1">
              View and manage email sending history
            </Typography>
          </div>
          {table && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <DataTableViewOptions
                table={table}
              />
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-foreground/[0.05] px-5 pb-5 [&_div.rounded-md.border]:border-0 [&_div.rounded-md.border]:shadow-none">
        <DataTable
          data={emailLogs}
          defaultColumnFilters={[]}
          columns={emailTableColumns}
          defaultSorting={[{ id: 'sentAt', desc: true }]}
          showDefaultToolbar={false}
          showResetFilters={false}
          onTableReady={(tableInstance) => {
            if (table !== tableInstance) {
              setTable(tableInstance);
            }
          }}
        />
      </div>
    </GlassCard>
  );
}

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

// Helper component for input with info tooltip
function InputFieldWithInfo({
  label,
  name,
  control,
  type,
  required,
  infoText,
  infoLinks,
}: {
  label: string,
  name: string,
  control: any,
  type: string,
  required?: boolean,
  infoText: string,
  infoLinks?: Array<{ label: string, url: string }>,
}) {
  const tooltipContent = (
    <div className="space-y-2.5 max-w-xs">
      <p className="text-xs leading-relaxed text-center">{infoText}</p>
      {infoLinks && infoLinks.length > 0 && (
        <div className="pt-2 border-t border-foreground/10 space-y-1.5 flex flex-col items-center">
          {infoLinks.map((link, idx) => (
            <a
              key={idx}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors duration-150 hover:transition-none cursor-pointer"
            >
              <span>{link.label}</span>
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <InputField
      label={
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <SimpleTooltip tooltip={tooltipContent} type="info" />
        </div>
      }
      name={name}
      control={control}
      type={type}
      // Don't pass required prop - it adds asterisk which we don't want
    />
  );
}

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
    const didUpdate = await updateConfig({
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
    if (!didUpdate) {
      return 'prevent-close-and-prevent-reset';
    }

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
          <InputFieldWithInfo
            label="Resend API Key"
            name="password"
            control={form.control}
            type="password"
            required
            infoText="Get your API key from resend.com/api-keys. Create a new key with 'Sending access' permissions."
          />
          <InputFieldWithInfo
            label="Sender Email"
            name="senderEmail"
            control={form.control}
            type="email"
            required
            infoText="The email address emails will be sent from. Must be a verified domain in your Resend account."
          />
          <InputField
            label="Sender Name"
            name="senderName"
            control={form.control}
            type="text"
            required
          />
          <Alert className="bg-blue-500/5 border-blue-500/20">
            <Typography variant="secondary" className="text-sm">
              <strong>Note:</strong> Your API key will be encrypted and securely stored in the database.
            </Typography>
          </Alert>
        </>}
        {form.watch('type') === 'standard' && <>
          <InputFieldWithInfo
            label="Host"
            name="host"
            control={form.control}
            type="text"
            required
            infoText="Your SMTP server hostname (e.g., smtp.gmail.com, smtp-mail.outlook.com, or smtp.your-domain.com)"
          />
          <InputFieldWithInfo
            label="Port"
            name="port"
            control={form.control}
            type="number"
            required
            infoText="Common ports: 587 (TLS/STARTTLS recommended), 465 (SSL), or 25 (unencrypted, not recommended)"
          />
          <InputFieldWithInfo
            label="Username"
            name="username"
            control={form.control}
            type="text"
            required
            infoText="Your SMTP username, usually your full email address (e.g., user@example.com)"
          />
          <InputFieldWithInfo
            label="Password"
            name="password"
            control={form.control}
            type="password"
            required
            infoText="Your SMTP password or app-specific password. Most email providers require app passwords for security."
            infoLinks={[
              { label: "Gmail: Create App Password", url: "https://myaccount.google.com/apppasswords" },
              { label: "Outlook: App Password Guide", url: "https://support.microsoft.com/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944" },
              { label: "Yahoo: Generate App Password", url: "https://help.yahoo.com/kb/generate-app-password-sln15241.html" },
            ]}
          />
          <InputFieldWithInfo
            label="Sender Email"
            name="senderEmail"
            control={form.control}
            type="email"
            required
            infoText="The email address that will appear as the sender. Must be authorized by your SMTP server."
          />
          <InputField
            label="Sender Name"
            name="senderName"
            control={form.control}
            type="text"
            required
          />
          <Alert className="bg-blue-500/5 border-blue-500/20">
            <Typography variant="secondary" className="text-sm">
              <strong>Note:</strong> Your SMTP credentials will be encrypted and securely stored in the database.
            </Typography>
          </Alert>
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
  const config = project.useConfig();
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
      const emailServerConfig = config.emails.server;
      if (emailServerConfig.isShared) {
        setError("Shared email server cannot be used for testing");
        return "prevent-close";
      }

      const missingFields: string[] = [];
      if (!emailServerConfig.host) missingFields.push("host");
      if (!emailServerConfig.port) missingFields.push("port");
      if (!emailServerConfig.username) missingFields.push("username");
      if (!emailServerConfig.password) missingFields.push("password");
      if (!emailServerConfig.senderName) missingFields.push("sender name");
      if (!emailServerConfig.senderEmail) missingFields.push("sender email");
      if (missingFields.length > 0) {
        setError(`Email server config is missing: ${missingFields.join(", ")}`);
        return "prevent-close";
      }

      // Convert CompleteConfig email server to AdminEmailConfig format
      const emailConfig: AdminEmailConfig = emailServerConfig.provider === 'resend' ? {
        type: 'resend',
        host: emailServerConfig.host ?? throwErr("Email host is missing"),
        port: emailServerConfig.port ?? throwErr("Email port is missing"),
        username: emailServerConfig.username ?? throwErr("Email username is missing"),
        password: emailServerConfig.password ?? throwErr("Email password is missing"),
        senderName: emailServerConfig.senderName ?? throwErr("Email sender name is missing"),
        senderEmail: emailServerConfig.senderEmail ?? throwErr("Email sender email is missing"),
      } : {
        type: 'standard',
        host: emailServerConfig.host ?? throwErr("Email host is missing"),
        port: emailServerConfig.port ?? throwErr("Email port is missing"),
        username: emailServerConfig.username ?? throwErr("Email username is missing"),
        password: emailServerConfig.password ?? throwErr("Email password is missing"),
        senderName: emailServerConfig.senderName ?? throwErr("Email sender name is missing"),
        senderEmail: emailServerConfig.senderEmail ?? throwErr("Email sender email is missing"),
      };

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
  {
    accessorKey: 'recipient',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Recipient" />,
    cell: ({ row }) => (
      <span className="text-sm font-medium text-foreground">{row.original.recipient}</span>
    ),
  },
  {
    accessorKey: 'subject',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Subject" />,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground truncate max-w-[300px] block">
        {row.original.subject}
      </span>
    ),
  },
  {
    accessorKey: 'sentAt',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Sent At" />,
    cell: ({ row }) => {
      const date = row.original.sentAt;
      return (
        <span className="text-sm text-muted-foreground tabular-nums font-mono">
          {date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })} {date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
        </span>
      );
    },
  },
  {
    id: 'status',
    accessorFn: (row) => (row.error ? 'failed' : 'sent'),
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.error ? 'failed' : 'sent'}
        error={row.original.error ? String(row.original.error) : null}
      />
    ),
  },
];

function SendEmailDialog(props: {
  trigger: React.ReactNode,
  emailConfig: CompleteConfig['emails']['server'],
}) {
  const stackAdminApp = useAdminApp();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sharedSmtpDialogOpen, setSharedSmtpDialogOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<ServerUser[]>([]);
  const [stage, setStage] = useState<'recipients' | 'data'>('recipients');

  const handleSend = async (formData: { subject?: string, content?: string, notificationCategoryName?: string }) => {
    if (!formData.subject || !formData.content || !formData.notificationCategoryName) {
      // Should never happen. These fields are only optional during recipient stage.
      throwErr("Missing required fields", { formData });
    }

    await stackAdminApp.sendEmail({
      userIds: selectedUsers.map(user => user.id),
      subject: formData.subject,
      html: formData.content,
      notificationCategoryName: formData.notificationCategoryName,
    });

    setSelectedUsers([]);
    setStage('recipients');
    toast({
      title: "Email sent",
      description: "Email was successfully sent",
      variant: 'success',
    });
  };

  const handleNext = async () => {
    if (selectedUsers.length === 0) {
      toast({
        title: "No recipients selected",
        description: "Please select at least one recipient to send the email.",
        variant: "destructive",
      });
      return "prevent-close" as const;
    }
    setStage('data');
    return "prevent-close" as const;
  };

  const handleBack = async () => {
    setStage('recipients');
    return "prevent-close" as const;
  };

  const handleClose = () => {
    setOpen(false);
    setStage('recipients');
    setSelectedUsers([]);
  };

  const renderRecipientsBar = () => (
    <div className="mb-4">
      <Typography className="font-medium mb-2">Recipients</Typography>
      <TooltipProvider>
        <div className="flex flex-wrap gap-2 mb-4">
          {selectedUsers.map((user) => (
            <div key={user.id} className="relative group">
              <Tooltip>
                <TooltipTrigger>
                  <UserAvatar user={user} size={32} />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <div className="max-w-60 text-center text-wrap whitespace-pre-wrap">
                    {user.primaryEmail}
                  </div>
                </TooltipContent>
              </Tooltip>
              {stage === 'recipients' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute -top-2 -right-2 h-4 w-4 rounded-full p-0 hover:bg-red-100 opacity-0 group-hover:opacity-100"
                  onClick={() => setSelectedUsers(users => users.filter(u => u.id !== user.id))}
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );

  return (
    <>
      <div
        onClick={() => {
          if (!props.emailConfig.isShared) {
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
          <WarningCircleIcon className="h-4 w-4" />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            You are using a shared email server. If you want to send manual emails, you need to configure a custom SMTP server.
          </AlertDescription>
        </Alert>
      </ActionDialog>
      <FormDialog
        open={open}
        onClose={handleClose}
        title="Send Email"
        cancelButton={stage === "recipients" ?
          { label: 'Cancel', onClick: async () => handleClose() } :
          { label: 'Back', onClick: handleBack }
        }
        okButton={stage === 'recipients' ?
          { label: 'Next' } :
          { label: 'Send' }
        }
        onSubmit={stage === 'recipients' ? handleNext : handleSend}
        formSchema={stage === "recipients" ?
          yup.object({
            subject: yup.string().optional(),
            content: yup.string().optional(),
            notificationCategoryName: yup.string().optional(),
          }) :
          yup.object({
            subject: yup.string().defined(),
            content: yup.string().defined(),
            notificationCategoryName: yup.string().oneOf(['Transactional', 'Marketing']).label("notification category").defined(),
          })
        }
        render={(form) => (
          <>
            {renderRecipientsBar()}
            {stage === 'recipients' ? (
              <TeamMemberSearchTable
                action={(user) => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedUsers(users =>
                      users.some(u => u.id === user.id)
                        ? users.filter(u => u.id !== user.id)
                        : [...users, user]
                    )}
                  >
                    {selectedUsers.some(u => u.id === user.id) ? 'Remove' : 'Add'}
                  </Button>
                )}
              />
            ) : (
              <>
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
          </>
        )}
      />
    </>
  );
}
