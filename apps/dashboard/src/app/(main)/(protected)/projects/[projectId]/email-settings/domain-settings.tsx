"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { DesignCard } from "@/components/design-components";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { cn } from "@/lib/utils";
import { AdminEmailConfig } from "@stackframe/stack";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { ArrowsClockwise, Envelope, GearSix, GlobeSimple, PaperPlaneTilt } from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { DesignAlert } from "@/components/design-components";
import { DesignButton } from "@/components/design-components";
import { DesignInput } from "@/components/design-components";
import { DesignSelectorDropdown } from "@/components/design-components";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label, Typography, useToast } from "@/components/ui";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { useCallback, useMemo, useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../use-admin-app";

type ServerType = "shared" | "managed" | "resend" | "standard";

type ManagedDomainStatus = "pending_dns" | "pending_verification" | "verified" | "applied" | "failed";

type ServerFieldConfig = {
  label: string,
  key: string,
  type: "text" | "email" | "number" | "password",
};

const SERVER_TYPE_LABELS: Record<ServerType, string> = {
  shared: "Shared (environment-configured)",
  managed: "Managed (via managed domain setup)",
  resend: "Resend",
  standard: "Custom SMTP",
};

const MANAGED_DOMAIN_STATUS_LABELS: Record<ManagedDomainStatus, string> = {
  pending_dns: "Pending DNS records",
  pending_verification: "Pending verification",
  verified: "Verified",
  applied: "Applied",
  failed: "Failed",
};

const VISIBLE_FIELDS: Record<ServerType, ServerFieldConfig[]> = {
  shared: [],
  managed: [],
  resend: [
    { label: "Sender Email", key: "senderEmail", type: "email" },
    { label: "Sender Name", key: "senderName", type: "text" },
  ],
  standard: [
    { label: "Sender Email", key: "senderEmail", type: "email" },
    { label: "Sender Name", key: "senderName", type: "text" },
  ],
};

const CONFIG_FIELDS: Record<ServerType, ServerFieldConfig[]> = {
  shared: [],
  managed: [],
  resend: [
    { label: "Resend API Key", key: "password", type: "password" },
  ],
  standard: [
    { label: "Host", key: "host", type: "text" },
    { label: "Port", key: "port", type: "number" },
    { label: "Username", key: "username", type: "text" },
    { label: "Password", key: "password", type: "password" },
  ],
};

function maskSecret(value: string): string {
  if (value.length <= 4) return "••••";
  return "••••••••" + value.slice(-4);
}

function getServerTypeFromConfig(config: CompleteConfig["emails"]["server"]): ServerType {
  if (config.isShared) return "shared";
  if (config.provider === "managed") return "managed";
  if (config.provider === "resend") return "resend";
  return "standard";
}

function getFormValuesFromConfig(
  config: CompleteConfig["emails"]["server"],
  projectName: string,
  sharedSenderEmail: string | null,
): Record<string, string> {
  if (config.isShared) {
    return {
      senderEmail: sharedSenderEmail ?? "Configured via STACK_EMAIL_SENDER",
      senderName: projectName,
    };
  }
  if (config.provider === "managed") {
    const senderEmail = config.managedSubdomain && config.managedSenderLocalPart
      ? `${config.managedSenderLocalPart}@${config.managedSubdomain}`
      : "";
    return {
      senderEmail,
      senderName: projectName,
      managedSubdomain: config.managedSubdomain ?? "",
      managedSenderLocalPart: config.managedSenderLocalPart ?? "",
    };
  }
  return {
    senderEmail: config.senderEmail ?? "",
    senderName: config.senderName ?? "",
    host: config.host ?? "",
    port: config.port != null ? String(config.port) : "",
    username: config.username ?? "",
    password: config.password ?? "",
  };
}

function TestSendingDialog(props: { trigger: React.ReactNode }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  return (
    <FormDialog
      trigger={props.trigger}
      title="Send a Test Email"
      formSchema={yup.object({ email: yup.string().email().defined().label("Recipient email address") })}
      okButton={{ label: "Send" }}
      onSubmit={async (values) => {
        const emailConfig = project.config.emailConfig ?? throwErr("Email config is not set");
        if (emailConfig.type === "shared") {
          throwErr("Shared email server cannot be used for testing");
        }
        const result = await stackAdminApp.sendTestEmail({ recipientEmail: values.email, emailConfig });
        if (result.status === "ok") {
          toast({ title: "Email sent", description: `Test email sent to ${values.email}. Check your inbox.`, variant: "success" });
        } else {
          setError(result.error.errorMessage);
          return "prevent-close";
        }
      }}
      cancelButton
      onFormChange={(form) => { if (form.getValues("email")) setError(null); }}
      render={(form) => (
        <>
          <InputField label="Email" name="email" control={form.control} type="email" autoComplete="email" required />
          {error && <DesignAlert variant="error" description={error} />}
        </>
      )}
    />
  );
}

const managedEmailSetupSchema = yup.object({
  subdomain: yup
    .string()
    .trim()
    .defined("Managed subdomain is required")
    .test(
      "non-empty-subdomain",
      "Managed subdomain is required",
      (value) => value.trim().length > 0,
    )
    .matches(
      /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9-]{2,63}$/,
      "Enter a full subdomain like emails.example.com",
    ),
  senderLocalPart: yup
    .string()
    .trim()
    .defined("Sender local part is required")
    .test(
      "non-empty-sender-local-part",
      "Sender local part is required",
      (value) => value.trim().length > 0,
    ),
});

function ManagedEmailSetupDialog(props: { trigger: React.ReactNode }) {
  const stackAdminApp = useAdminApp();
  const [open, setOpen] = useState(false);
  const [setupState, setSetupState] = useState<{
    domainId: string,
    nameServerRecords: string[],
    subdomain: string,
    senderLocalPart: string,
    status: ManagedDomainStatus,
  } | null>(null);
  const [domains, setDomains] = useState<Array<{
    domainId: string,
    subdomain: string,
    senderLocalPart: string,
    status: ManagedDomainStatus,
    nameServerRecords: string[],
  }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingDomains, setLoadingDomains] = useState(false);

  const refreshDomains = async () => {
    setLoadingDomains(true);
    try {
      const result = await stackAdminApp.listManagedEmailDomains();
      setDomains(result);
    } finally {
      setLoadingDomains(false);
    }
  };

  return (
    <FormDialog
      trigger={props.trigger}
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (newOpen) {
          runAsynchronouslyWithAlert(async () => {
            await refreshDomains();
          }, {
            onError: (err) => {
              setError(err instanceof Error ? err.message : "Failed to load managed domains");
            },
          });
        } else {
          setSetupState(null);
          setDomains([]);
          setError(null);
        }
      }}
      title="Managed Email Setup"
      formSchema={managedEmailSetupSchema}
      defaultValues={{ subdomain: "", senderLocalPart: "updates" }}
      okButton={setupState ? false : { label: "Start Setup" }}
      cancelButton
      onSubmit={async (values) => {
        const setupResult = await stackAdminApp.setupManagedEmailProvider({
          subdomain: values.subdomain,
          senderLocalPart: values.senderLocalPart,
        });
        setSetupState({
          domainId: setupResult.domainId,
          nameServerRecords: setupResult.nameServerRecords,
          subdomain: setupResult.subdomain,
          senderLocalPart: setupResult.senderLocalPart,
          status: setupResult.status,
        });
        await refreshDomains();
        setError(null);
        return "prevent-close" as const;
      }}
      render={(form) => (
        <>
          {!setupState && (
            <>
              <InputField
                label="Managed subdomain"
                name="subdomain"
                control={form.control}
                type="text"
                placeholder="emails.example.com"
                required
              />
              <InputField
                label="Sender local part"
                name="senderLocalPart"
                control={form.control}
                type="text"
                required
              />
            </>
          )}
          {setupState && (
            <Alert className="bg-blue-500/5 border-blue-500/20">
              <AlertTitle>Delegate your subdomain with these NS records</AlertTitle>
              <AlertDescription>
                Add these nameservers at your DNS provider for the managed subdomain you entered.
                <div className="mt-2 flex flex-col gap-1">
                  {setupState.nameServerRecords.map((record) => (
                    <div key={record} className="font-mono text-xs">{record}</div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}
          {setupState && (
            <div className="flex items-center gap-2">
              <DesignButton
                variant="secondary"
                size="sm"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  const result = await stackAdminApp.checkManagedEmailStatus({
                    domainId: setupState.domainId,
                    subdomain: setupState.subdomain,
                    senderLocalPart: setupState.senderLocalPart,
                  });
                  setSetupState({ ...setupState, status: result.status });
                  await refreshDomains();
                })}
              >
                <ArrowsClockwise className="h-3.5 w-3.5 mr-1" />
                Refresh Status
              </DesignButton>
              <DesignButton
                size="sm"
                disabled={setupState.status !== "verified"}
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await stackAdminApp.applyManagedEmailProvider({
                    domainId: setupState.domainId,
                  });
                  setOpen(false);
                })}
              >
                Use This Domain
              </DesignButton>
            </div>
          )}
          {(() => {
            const visibleDomains = setupState ? domains.filter((d) => d.domainId === setupState.domainId) : domains;
            return (
              <div className="space-y-2">
                <Typography variant="secondary" className="text-xs uppercase tracking-wider">Tracked managed domains</Typography>
                {loadingDomains ? (
                  <Typography variant="secondary" className="text-sm">Loading managed domains...</Typography>
                ) : visibleDomains.length === 0 ? (
                  <Typography variant="secondary" className="text-sm">No managed domains tracked yet.</Typography>
                ) : (
                  visibleDomains.map((domain) => (
                    <Alert key={domain.domainId} className="bg-slate-500/5 border-slate-500/20">
                      <AlertTitle className="font-mono text-xs">{domain.senderLocalPart}@{domain.subdomain}</AlertTitle>
                      <AlertDescription className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-xs">Status: {(MANAGED_DOMAIN_STATUS_LABELS as Record<string, string>)[domain.status] ?? domain.status}</span>
                        <DesignButton
                          size="sm"
                          variant="secondary"
                          disabled={domain.status !== "verified"}
                          onClick={() => runAsynchronouslyWithAlert(async () => {
                            await stackAdminApp.applyManagedEmailProvider({
                              domainId: domain.domainId,
                            });
                            await refreshDomains();
                          })}
                        >
                          Use This Domain
                        </DesignButton>
                      </AlertDescription>
                    </Alert>
                  ))
                )}
              </div>
            );
          })()}
          {error && <DesignAlert variant="error" description={error} />}
        </>
      )}
    />
  );
}

export function DomainSettings() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;
  const sharedSenderEmail = project.config.emailConfig?.type === "shared"
    && "senderEmail" in project.config.emailConfig
    && typeof project.config.emailConfig.senderEmail === "string"
    ? project.config.emailConfig.senderEmail
    : null;
  const updateConfig = useUpdateConfig();
  const { toast } = useToast();
  const isEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";

  const savedServerType = getServerTypeFromConfig(emailConfig);
  const savedValues = getFormValuesFromConfig(
    emailConfig,
    project.displayName,
    sharedSenderEmail,
  );

  const [serverType, setServerType] = useState<ServerType>(savedServerType);
  const [formValues, setFormValues] = useState<Record<string, string>>(savedValues);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isShared = serverType === "shared";
  const visibleFields = VISIBLE_FIELDS[serverType];
  const configFields = CONFIG_FIELDS[serverType];
  const hasConfigFields = configFields.length > 0;

  const isDirty = useMemo(() => {
    if (serverType !== savedServerType) return true;
    for (const field of [...visibleFields, ...configFields]) {
      if ((formValues[field.key] || "") !== (savedValues[field.key] || "")) return true;
    }
    return false;
  }, [serverType, savedServerType, formValues, savedValues, visibleFields, configFields]);

  const updateField = useCallback((key: string, value: string) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
    setSaveError(null);
  }, []);

  const handleServerTypeChange = useCallback((newType: ServerType) => {
    setServerType(newType);
    if (CONFIG_FIELDS[newType].length > 0) {
      setConfigExpanded(true);
    }
    setSaveError(null);
  }, []);

  const handleDiscard = useCallback(() => {
    setServerType(savedServerType);
    setFormValues(savedValues);
    setSaveError(null);
  }, [savedServerType, savedValues]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (serverType === "shared") {
        await updateConfig({
          adminApp: stackAdminApp,
          configUpdate: {
            "emails.server": { isShared: true } satisfies Partial<CompleteConfig["emails"]["server"]>,
          },
          pushable: false,
        });
        toast({ title: "Email server updated", variant: "success" });
      } else if (serverType === "managed") {
        toast({
          title: "Email server unchanged",
          description: "Managed email configuration is controlled through the managed domain setup.",
          variant: "success",
        });
      } else {
        const requireField = (key: string, label: string): string => {
          const val = formValues[key];
          if (!val) throwErr(`${label} is required`);
          return val;
        };

        const emailConf: AdminEmailConfig & { type: "standard" | "resend" } = serverType === "resend" ? {
          type: "resend",
          host: "smtp.resend.com",
          port: 465,
          username: "resend",
          password: requireField("password", "Resend API key"),
          senderEmail: requireField("senderEmail", "Sender email"),
          senderName: requireField("senderName", "Sender name"),
        } : {
          type: "standard",
          host: requireField("host", "Host"),
          port: (() => {
            const p = Number(formValues.port);
            if (!Number.isInteger(p) || p < 1 || p > 65535) {
              throwErr("Port must be an integer between 1 and 65535");
            }
            return p;
          })(),
          username: requireField("username", "Username"),
          password: requireField("password", "Password"),
          senderEmail: requireField("senderEmail", "Sender email"),
          senderName: requireField("senderName", "Sender name"),
        };

        const testResult = await stackAdminApp.sendTestEmail({
          recipientEmail: "test-email-recipient@stackframe.co",
          emailConfig: emailConf,
        });

        if (testResult.status === "error") {
          setSaveError(testResult.error.errorMessage);
          return;
        }

        await updateConfig({
          adminApp: stackAdminApp,
          configUpdate: {
            "emails.server": {
              isShared: false,
              host: emailConf.host,
              port: emailConf.port,
              username: emailConf.username,
              password: emailConf.password,
              senderEmail: emailConf.senderEmail,
              senderName: emailConf.senderName,
              provider: emailConf.type === "resend" ? "resend" : "smtp",
              managedSubdomain: undefined,
              managedSenderLocalPart: undefined,
            } satisfies CompleteConfig["emails"]["server"],
          },
          pushable: false,
        });
        toast({ title: "Email server updated", variant: "success" });
      }
    } finally {
      setSaving(false);
    }
  }, [serverType, formValues, stackAdminApp, updateConfig, toast]);

  if (isEmulator) {
    return (
      <DesignCard title="Mock Emails" subtitle="View all emails sent through the emulator in Inbucket" icon={Envelope} gradient="default">
        <DesignButton variant="secondary" onClick={() => {
          window.open(getPublicEnvVar("NEXT_PUBLIC_STACK_INBUCKET_WEB_URL") + "/monitor", "_blank");
        }}>
          Open Inbox
        </DesignButton>
      </DesignCard>
    );
  }

  const emailFormatError = !isShared && formValues.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formValues.senderEmail)
    ? "Invalid email format" : null;

  const missingRequiredFields = !isShared ? [
    ...visibleFields.filter(f => !(formValues[f.key] || "").trim()),
    ...configFields.filter(f => !(formValues[f.key] || "").trim()),
  ] : [];

  const canSave = isDirty && !emailFormatError && missingRequiredFields.length === 0;

  return (
    <DesignCard gradient="default">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
            <Envelope className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
          </div>
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Email Server
          </span>
        </div>

        {/* Sender identity + server type -- 3-column grid */}
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server Type</Label>
            <DesignSelectorDropdown
              value={serverType}
              onValueChange={(v) => handleServerTypeChange(v as ServerType)}
              options={[
                { value: "shared", label: SERVER_TYPE_LABELS.shared },
                { value: "managed", label: SERVER_TYPE_LABELS.managed },
                { value: "resend", label: SERVER_TYPE_LABELS.resend },
                { value: "standard", label: SERVER_TYPE_LABELS.standard },
              ]}
              size="md"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender Email</Label>
            {isShared ? (
              <SimpleTooltip tooltip="Sender email is read from STACK_EMAIL_SENDER on the server.">
                <Typography className="text-sm font-medium text-foreground/60 cursor-default py-1">
                  {sharedSenderEmail ?? "Configured via STACK_EMAIL_SENDER"}
                </Typography>
              </SimpleTooltip>
            ) : serverType === "managed" ? (
              <SimpleTooltip tooltip="Sender email is configured through the managed domain setup">
                <Typography className="text-sm font-medium text-foreground/60 cursor-default py-1">
                  {formValues.senderEmail || "Not configured"}
                </Typography>
              </SimpleTooltip>
            ) : (
              <>
                <DesignInput
                  value={formValues.senderEmail || ""}
                  onChange={(e) => updateField("senderEmail", e.target.value)}
                  className={cn(emailFormatError && "border-destructive")}
                  type="email"
                  placeholder="you@example.com"
                  size="md"
                />
                {emailFormatError && (
                  <Typography variant="secondary" className="text-xs text-destructive">{emailFormatError}</Typography>
                )}
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender Name</Label>
            {isShared || serverType === "managed" ? (
              <SimpleTooltip tooltip={isShared ? "Sender name uses your project name on the shared server" : "Sender name uses your project name for managed email"}>
                <Typography className="text-sm font-medium text-foreground/60 cursor-default py-1">{project.displayName}</Typography>
              </SimpleTooltip>
            ) : (
              <DesignInput
                value={formValues.senderName || ""}
                onChange={(e) => updateField("senderName", e.target.value)}
                type="text"
                placeholder="Your App Name"
                size="md"
              />
            )}
          </div>
        </div>

        {/* Managed domain info + setup trigger */}
        {serverType === "managed" && (
          <div className="space-y-4 border-t border-border/40 pt-4">
            {savedServerType === "managed" && formValues.managedSubdomain && (
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Managed Domain</Label>
                  <Typography className="text-sm font-medium font-mono">{formValues.managedSubdomain}</Typography>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender</Label>
                  <Typography className="text-sm font-medium font-mono">{formValues.senderEmail}</Typography>
                </div>
              </div>
            )}
            <ManagedEmailSetupDialog
              trigger={
                <DesignButton variant="secondary" size="sm" className="gap-1.5">
                  <GlobeSimple className="h-3.5 w-3.5" />
                  {savedServerType === "managed" ? "Manage Domain" : "Set Up Managed Domain"}
                </DesignButton>
              }
            />
          </div>
        )}

        {/* Send Test Email -- prominent, centered */}
        {!isShared && serverType !== "managed" && !isDirty && (
          <div className="flex justify-center">
            <TestSendingDialog
              trigger={
                <DesignButton variant="outline" className="gap-2 hover:bg-accent">
                  <PaperPlaneTilt className="h-4 w-4" />
                  Send Test Email
                </DesignButton>
              }
            />
          </div>
        )}

        {/* Config expand toggle + expanded fields */}
        {hasConfigFields && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-t border-border/40 pt-4">
              <SimpleTooltip tooltip={configExpanded ? "Hide server configuration" : "Show server configuration"}>
                <button
                  type="button"
                  onClick={() => setConfigExpanded(!configExpanded)}
                  className={cn(
                    "p-2 rounded-lg transition-colors duration-150 hover:transition-none",
                    "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]",
                    configExpanded && "bg-foreground/[0.06] text-foreground"
                  )}
                >
                  <GearSix size={16} weight={configExpanded ? "fill" : "regular"} />
                </button>
              </SimpleTooltip>
              <Typography variant="secondary" className="text-xs">
                {configExpanded ? "Server configuration" : "Show server configuration"}
              </Typography>
            </div>

            {configExpanded && (
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {configFields.map((field) => {
                  const isEmpty = !(formValues[field.key] || "").trim();
                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{field.label}</Label>
                      <DesignInput
                        value={formValues[field.key] || ""}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        className={cn(isDirty && isEmpty && "border-destructive")}
                        type={field.type}
                        size="md"
                      />
                      {isDirty && isEmpty && (
                        <Typography variant="secondary" className="text-xs text-destructive">{field.label} is required</Typography>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <DesignAlert variant="error" description={saveError} />
        )}

        {/* Save / Cancel -- only when dirty, not for managed (config is set through setup dialog) */}
        {isDirty && serverType !== "managed" && (
          <div className="flex justify-end gap-2 pt-3 border-t border-border/40">
            <DesignButton variant="secondary" size="sm" onClick={handleDiscard} disabled={saving}>
              Cancel
            </DesignButton>
            <DesignButton
              size="sm"
              loading={saving}
              disabled={!canSave}
              onClick={() => runAsynchronouslyWithAlert(handleSave)}
            >
              Save
            </DesignButton>
          </div>
        )}
      </div>
    </DesignCard>
  );
}
