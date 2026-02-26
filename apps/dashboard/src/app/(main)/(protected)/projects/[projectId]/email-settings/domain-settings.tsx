"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { DesignCard } from "@/components/design-components/card";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { cn } from "@/lib/utils";
import { AdminEmailConfig } from "@stackframe/stack";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { strictEmailSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { Envelope, GearSix, PaperPlaneTilt } from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignButton } from "@/components/design-components/button";
import { DesignInput } from "@/components/design-components/input";
import { DesignSelectorDropdown } from "@/components/design-components/select";
import { Label, Typography, useToast } from "@/components/ui";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { useCallback, useMemo, useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../use-admin-app";

type ServerType = "shared" | "resend" | "standard";

type ServerFieldConfig = {
  label: string,
  key: string,
  type: "text" | "email" | "number" | "password",
};

const SERVER_TYPE_LABELS: Record<ServerType, string> = {
  shared: "Shared (noreply@stackframe.co)",
  resend: "Resend",
  standard: "Custom SMTP",
};

const VISIBLE_FIELDS: Record<ServerType, ServerFieldConfig[]> = {
  shared: [],
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
  if (config.provider === "resend") return "resend";
  return "standard";
}

function getFormValuesFromConfig(config: CompleteConfig["emails"]["server"], projectName: string): Record<string, string> {
  if (config.isShared) {
    return { senderEmail: "noreply@stackframe.co", senderName: projectName };
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

export function DomainSettings() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;
  const updateConfig = useUpdateConfig();
  const { toast } = useToast();
  const isEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true";

  const savedServerType = getServerTypeFromConfig(emailConfig);
  const savedValues = getFormValuesFromConfig(emailConfig, project.displayName);

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
                { value: "resend", label: SERVER_TYPE_LABELS.resend },
                { value: "standard", label: SERVER_TYPE_LABELS.standard },
              ]}
              size="md"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender Email</Label>
            {isShared ? (
              <SimpleTooltip tooltip="Sender email is fixed on the shared server">
                <Typography className="text-sm font-medium text-foreground/60 cursor-default py-1">noreply@stackframe.co</Typography>
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
            {isShared ? (
              <SimpleTooltip tooltip="Sender name uses your project name on the shared server">
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

        {/* Send Test Email -- prominent, centered */}
        {!isShared && !isDirty && (
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

        {/* Save / Cancel -- only when dirty */}
        {isDirty && (
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
