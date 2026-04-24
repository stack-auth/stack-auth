"use client";

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import {
  DesignAlert,
  DesignButton,
  DesignCard,
  DesignInput,
} from "@/components/design-components";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { cn } from "@/lib/utils";
import { AdminEmailConfig } from "@stackframe/stack";
import { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import {
  ArrowLeft,
  ArrowsClockwise,
  CheckCircle,
  Cloud,
  CopySimple,
  Envelope,
  GlobeSimple,
  HardDrives,
  type Icon as PhosphorIcon,
  PaperPlaneTilt,
  Plus,
  ShieldCheck,
  Spinner,
  WarningDiamond,
} from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Dialog, DialogContent, DialogTitle, Label, Typography, useToast } from "@/components/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import Image from "next/image";
import { useAdminApp } from "../use-admin-app";

type ServerType = "shared" | "managed" | "resend" | "standard";

type ManagedDomainStatus = "pending_dns" | "pending_verification" | "verified" | "applied" | "failed";

const DEFAULT_SHARED_SENDER_EMAIL = "noreply@stackframe.co";

type ServerFieldConfig = {
  label: string,
  key: string,
  type: "text" | "email" | "number" | "password",
};

const SERVER_TYPE_LABELS: Record<Exclude<ServerType, "shared">, string> = {
  managed: "Managed (via managed domain setup)",
  resend: "Resend",
  standard: "Custom SMTP",
};

type ManagedDomain = {
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
  status: ManagedDomainStatus,
  nameServerRecords: string[],
};

type SetupState = {
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
  nameServerRecords: string[],
  status: ManagedDomainStatus,
};

function getSharedServerTypeLabel(senderEmail: string | undefined): string {
  return `Shared (${senderEmail || DEFAULT_SHARED_SENDER_EMAIL})`;
}

const MANAGED_DOMAIN_STATUS_LABELS: Record<ManagedDomainStatus, string> = {
  pending_dns: "Waiting for DNS",
  pending_verification: "Verifying…",
  verified: "Verified",
  applied: "Active",
  failed: "Failed",
};

const MANAGED_DOMAIN_STATUS_COLORS: Record<ManagedDomainStatus, string> = {
  pending_dns: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  pending_verification: "text-blue-600 dark:text-blue-400 bg-blue-500/10",
  verified: "text-green-600 dark:text-green-400 bg-green-500/10",
  applied: "text-green-600 dark:text-green-400 bg-green-500/10",
  failed: "text-red-600 dark:text-red-400 bg-red-500/10",
};

function getServerTypeFromConfig(config: CompleteConfig["emails"]["server"]): ServerType {
  if (config.isShared) return "shared";
  if (config.provider === "managed") return "managed";
  if (config.provider === "resend") return "resend";
  return "standard";
}

function getFormValuesFromConfig(config: CompleteConfig["emails"]["server"], projectName: string): Record<string, string> {
  if (config.isShared) {
    return { senderEmail: config.senderEmail ?? "", senderName: projectName };
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

function ResendIcon({ className }: { className?: string }) {
  return (
    <>
      <Image
        src="/assets/resend-icon-black.svg"
        alt=""
        width={20}
        height={20}
        aria-hidden
        className={cn(className, "block dark:hidden")}
      />
      <Image
        src="/assets/resend-icon-white.svg"
        alt=""
        width={20}
        height={20}
        aria-hidden
        className={cn(className, "hidden dark:block")}
      />
    </>
  );
}

type ProviderMeta = {
  value: ServerType,
  label: string,
  tagline: string,
  icon?: PhosphorIcon,
  customIcon?: React.ReactNode,
};

const PROVIDERS: ProviderMeta[] = [
  {
    value: "shared",
    label: "Stack Shared",
    tagline: "Only default emails — no custom templates, themes, or sender identity.",
    icon: Cloud,
  },
  {
    value: "managed",
    label: "Managed Domain",
    tagline: "Bring your own domain. You add DNS records; we handle signing & delivery.",
    icon: ShieldCheck,
  },
  {
    value: "resend",
    label: "Resend",
    tagline: "Connect a Resend account with an API key.",
    customIcon: <ResendIcon className="h-5 w-5" />,
  },
  {
    value: "standard",
    label: "Custom SMTP",
    tagline: "SendGrid, Postmark, AWS SES — any SMTP.",
    icon: HardDrives,
  },
];

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

const subdomainSchema = yup
  .string()
  .trim()
  .defined("Managed subdomain is required")
  .test("non-empty-subdomain", "Managed subdomain is required", (value) => value.trim().length > 0)
  .matches(
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9-]{2,63}$/,
    "Enter a full subdomain like emails.example.com",
  );

const senderLocalPartSchema = yup
  .string()
  .trim()
  .defined("Sender local part is required")
  .test("non-empty", "Sender local part is required", (value) => value.trim().length > 0);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        runAsynchronouslyWithAlert(async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="shrink-0 p-1 rounded-md hover:bg-foreground/[0.06] text-muted-foreground hover:text-foreground transition-colors"
      title={copied ? "Copied" : "Copy"}
    >
      {copied
        ? <CheckCircle className="h-3.5 w-3.5 text-green-600" weight="fill" />
        : <CopySimple className="h-3.5 w-3.5" />}
    </button>
  );
}

function ManagedDomainSetupDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  initialState: SetupState | null,
  onCompleted: () => void,
}) {
  const stackAdminApp = useAdminApp();
  const { toast } = useToast();
  const [stage, setStage] = useState<1 | 2 | 3>(props.initialState ? 2 : 1);
  const [subdomain, setSubdomain] = useState(props.initialState?.subdomain ?? "");
  const [senderLocalPart, setSenderLocalPart] = useState(props.initialState?.senderLocalPart ?? "updates");
  const [setupState, setSetupState] = useState<SetupState | null>(props.initialState);
  const [stage1Error, setStage1Error] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (props.open) {
      setStage(props.initialState ? 2 : 1);
      setSubdomain(props.initialState?.subdomain ?? "");
      setSenderLocalPart(props.initialState?.senderLocalPart ?? "updates");
      setSetupState(props.initialState);
      setStage1Error(null);
      setError(null);
      setSubmitting(false);
      setChecking(false);
    }
  }, [props.open, props.initialState]);

  const handleContinue = useCallback(async () => {
    setStage1Error(null);
    try {
      await subdomainSchema.validate(subdomain);
      await senderLocalPartSchema.validate(senderLocalPart);
    } catch (e) {
      setStage1Error(e instanceof yup.ValidationError ? e.message : "Invalid input");
      return;
    }
    setSubmitting(true);
    try {
      const result = await stackAdminApp.setupManagedEmailProvider({
        subdomain: subdomain.trim(),
        senderLocalPart: senderLocalPart.trim(),
      });
      const nextState: SetupState = {
        domainId: result.domainId,
        nameServerRecords: result.nameServerRecords,
        subdomain: result.subdomain,
        senderLocalPart: result.senderLocalPart,
        status: result.status,
      };
      setSetupState(nextState);
      setStage(nextState.status === "verified" || nextState.status === "applied" ? 3 : 2);
      props.onCompleted();
    } catch (e) {
      setStage1Error(e instanceof Error ? e.message : "Failed to set up domain");
    } finally {
      setSubmitting(false);
    }
  }, [subdomain, senderLocalPart, stackAdminApp, props]);

  const handleCheck = useCallback(async () => {
    if (!setupState) return;
    setChecking(true);
    setError(null);
    try {
      const result = await stackAdminApp.checkManagedEmailStatus({
        domainId: setupState.domainId,
        subdomain: setupState.subdomain,
        senderLocalPart: setupState.senderLocalPart,
      });
      const next: SetupState = { ...setupState, status: result.status };
      setSetupState(next);
      if (next.status === "verified" || next.status === "applied") {
        setStage(3);
      } else if (next.status === "failed") {
        setError("Verification failed. Double-check your DNS records and try again.");
      } else {
        toast({
          title: "DNS not yet propagated",
          description: "Give it a few more minutes — changes can take up to 48 hours.",
        });
      }
      props.onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check verification");
    } finally {
      setChecking(false);
    }
  }, [setupState, stackAdminApp, toast, props]);

  const handleApply = useCallback(async () => {
    if (!setupState) return;
    setSubmitting(true);
    setError(null);
    try {
      await stackAdminApp.applyManagedEmailProvider({ domainId: setupState.domainId });
      toast({ title: "Domain applied", description: `Sending emails from ${setupState.senderLocalPart}@${setupState.subdomain}.`, variant: "success" });
      props.onCompleted();
      props.onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply domain");
    } finally {
      setSubmitting(false);
    }
  }, [setupState, stackAdminApp, toast, props]);

  const steps = [
    { n: 1 as const, title: "Your domain" },
    { n: 2 as const, title: "DNS records" },
    { n: 3 as const, title: "Verify" },
  ];

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[680px] p-0 gap-0" noCloseButton>
        <DialogTitle className="sr-only">Add managed domain</DialogTitle>

        <div className="px-6 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-base font-semibold text-foreground">Add managed domain</div>
              <div className="text-xs text-muted-foreground mt-0.5">Bring your own domain — takes about 5 minutes.</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {steps.map((s, i) => {
              const isDone = s.n < stage;
              const isActive = s.n === stage;
              const isLast = i === steps.length - 1;
              const marker = (
                <div className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                  isDone && "bg-green-500 text-white",
                  isActive && "bg-foreground text-background",
                  !isDone && !isActive && "bg-foreground/[0.08] text-muted-foreground",
                )}>
                  {isDone ? <CheckCircle size={14} weight="fill" /> : s.n}
                </div>
              );
              const label = (
                <span className={cn(
                  "text-xs font-medium whitespace-nowrap",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}>
                  {s.title}
                </span>
              );
              return (
                <div key={s.n} className={cn("flex items-center gap-2", !isLast && "flex-1")}>
                  {isLast ? (
                    <>
                      {label}
                      {marker}
                    </>
                  ) : (
                    <>
                      {marker}
                      {label}
                      <div className={cn("flex-1 h-px", isDone ? "bg-green-500/60" : "bg-border")} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {stage === 1 && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subdomain you own</Label>
                <DesignInput
                  value={subdomain}
                  onChange={(e) => {
                    setSubdomain(e.target.value);
                    setStage1Error(null);
                  }}
                  type="text"
                  placeholder="emails.example.com"
                  size="md"
                />
                <Typography variant="secondary" className="text-xs">
                  Use a dedicated subdomain (e.g. <span className="font-mono">emails.example.com</span>), not your apex domain.
                </Typography>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender local part</Label>
                <div className="flex items-center gap-2">
                  <DesignInput
                    value={senderLocalPart}
                    onChange={(e) => {
                      setSenderLocalPart(e.target.value);
                      setStage1Error(null);
                    }}
                    type="text"
                    size="md"
                  />
                  <Typography variant="secondary" className="text-sm font-mono whitespace-nowrap">
                    @{subdomain || "your-subdomain"}
                  </Typography>
                </div>
              </div>
              {stage1Error && <DesignAlert variant="error" description={stage1Error} />}
            </>
          )}

          {stage === 2 && setupState && (
            <>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Add these records to <span className="font-mono">{setupState.subdomain}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Log into your DNS provider and create each row below. We&apos;ll detect them automatically.
                </div>
              </div>

              <div className="rounded-lg border border-border/60 overflow-hidden">
                <div className="grid grid-cols-[72px_160px_1fr] px-3 py-2 bg-foreground/[0.04] border-b border-border/50">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Content</div>
                </div>
                {setupState.nameServerRecords.map((r, i) => (
                  <div
                    key={`${r}-${i}`}
                    className={cn(
                      "grid grid-cols-[72px_160px_1fr] items-center px-3 py-2",
                      i < setupState.nameServerRecords.length - 1 && "border-b border-border/40",
                    )}
                  >
                    <span className="font-mono text-[11px] font-semibold text-foreground/80">NS</span>
                    <span className="font-mono text-xs text-foreground truncate">{setupState.subdomain}</span>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="font-mono text-xs text-foreground truncate">{r}</span>
                      <CopyButton text={r} />
                    </div>
                  </div>
                ))}
              </div>

              <Typography variant="secondary" className="text-xs">
                DNS changes typically propagate within 10 minutes but can take up to 48 hours.
              </Typography>

              {error && <DesignAlert variant="error" description={error} />}
            </>
          )}

          {stage === 3 && setupState && (
            <div className="py-6 flex flex-col items-center text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle size={28} weight="fill" className="text-green-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">Domain verified</div>
                <div className="text-xs text-muted-foreground mt-1">
                  <span className="font-mono">{setupState.senderLocalPart}@{setupState.subdomain}</span> is ready to send.
                </div>
              </div>
              {error && <DesignAlert variant="error" description={error} />}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border/40 flex items-center justify-between">
          {stage === 2 && setupState ? (
            <DesignButton
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={() => setStage(1)}
              disabled={submitting || checking}
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </DesignButton>
          ) : stage === 3 ? (
            <DesignButton variant="secondary" size="sm" onClick={() => props.onOpenChange(false)}>
              Close
            </DesignButton>
          ) : (
            <DesignButton variant="secondary" size="sm" onClick={() => props.onOpenChange(false)}>
              Cancel
            </DesignButton>
          )}
          <div className="flex gap-2">
            {stage === 2 && (
              <DesignButton
                variant="outline"
                size="sm"
                className="gap-1.5"
                loading={checking}
                onClick={() => runAsynchronouslyWithAlert(handleCheck)}
              >
                <ArrowsClockwise className="h-3.5 w-3.5" /> Check verification
              </DesignButton>
            )}
            {stage === 1 && (
              <DesignButton
                size="sm"
                loading={submitting}
                onClick={() => runAsynchronouslyWithAlert(handleContinue)}
              >
                Continue
              </DesignButton>
            )}
            {stage === 3 && (
              <DesignButton
                size="sm"
                loading={submitting}
                onClick={() => runAsynchronouslyWithAlert(handleApply)}
              >
                Use this domain
              </DesignButton>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DomainSettings() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;
  const updateConfig = useUpdateConfig();
  const { toast } = useToast();
  const isEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";

  const savedServerType = getServerTypeFromConfig(emailConfig);
  const savedValues = getFormValuesFromConfig(emailConfig, project.displayName);

  const [serverType, setServerType] = useState<ServerType>(savedServerType);
  const [formValues, setFormValues] = useState<Record<string, string>>(savedValues);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [domains, setDomains] = useState<ManagedDomain[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [dialog, setDialog] = useState<{ initialState: SetupState | null } | null>(null);

  const refreshDomains = useCallback(async () => {
    setLoadingDomains(true);
    try {
      const result = await stackAdminApp.listManagedEmailDomains();
      setDomains(result);
    } finally {
      setLoadingDomains(false);
    }
  }, [stackAdminApp]);

  useEffect(() => {
    if (serverType === "managed") {
      runAsynchronouslyWithAlert(refreshDomains);
    }
  }, [serverType, refreshDomains]);

  const isShared = serverType === "shared";

  const visibleSenderFields = serverType === "resend" || serverType === "standard";
  const configFields = useMemo(() => {
    if (serverType === "resend") {
      return [{ label: "Resend API Key", key: "password", type: "password" as const }];
    }
    if (serverType === "standard") {
      return [
        { label: "Host", key: "host", type: "text" as const },
        { label: "Port", key: "port", type: "number" as const },
        { label: "Username", key: "username", type: "text" as const },
        { label: "Password", key: "password", type: "password" as const },
      ];
    }
    return [];
  }, [serverType]);

  const isDirty = useMemo(() => {
    if (serverType !== savedServerType) return true;
    const keys = new Set<string>();
    if (visibleSenderFields) {
      keys.add("senderEmail");
      keys.add("senderName");
    }
    for (const f of configFields) keys.add(f.key);
    for (const k of keys) {
      if ((formValues[k] || "") !== (savedValues[k] || "")) return true;
    }
    return false;
  }, [serverType, savedServerType, formValues, savedValues, visibleSenderFields, configFields]);

  const updateField = useCallback((key: string, value: string) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
    setSaveError(null);
  }, []);

  const handleSelectProvider = useCallback((newType: ServerType) => {
    setServerType(newType);
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
              managedSubdomain: undefined,
              managedSenderLocalPart: undefined,
            } satisfies CompleteConfig["emails"]["server"],
          },
          pushable: false,
        });
        toast({ title: "Email server updated", variant: "success" });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save changes");
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

  const emailFormatError = visibleSenderFields && formValues.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formValues.senderEmail)
    ? "Invalid email format" : null;

  const missingRequiredFields = visibleSenderFields ? [
    ...(!(formValues.senderEmail || "").trim() ? ["Sender Email"] : []),
    ...(!(formValues.senderName || "").trim() ? ["Sender Name"] : []),
    ...configFields.filter(f => !(formValues[f.key] || "").trim()).map(f => f.label),
  ] : [];

  const canSave = isDirty && !emailFormatError && missingRequiredFields.length === 0;
  const activeManagedDomainId = emailConfig.provider === "managed" && emailConfig.managedSubdomain && emailConfig.managedSenderLocalPart
    ? domains.find((d) =>
      d.subdomain === emailConfig.managedSubdomain
      && d.senderLocalPart === emailConfig.managedSenderLocalPart
    )?.domainId
    : null;

  return (
    <>
      <DesignCard gradient="default">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                <Envelope className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
              </div>
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Email Server</span>
            </div>
            {!isShared && serverType !== "managed" && !isDirty && (
              <TestSendingDialog
                trigger={
                  <DesignButton variant="outline" size="sm" className="gap-1.5">
                    <PaperPlaneTilt className="h-3.5 w-3.5" />
                    Send test email
                  </DesignButton>
                }
              />
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PROVIDERS.map((p) => {
              const isSelected = serverType === p.value;
              const isSaved = savedServerType === p.value;
              const isDraft = isSelected && !isSaved;
              const Icon = p.icon;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleSelectProvider(p.value)}
                  className={cn(
                    "relative text-left rounded-xl border p-4 transition-all",
                    isSaved && "border-green-500/40 bg-green-500/[0.04]",
                    isDraft && "border-amber-500/50 bg-amber-500/[0.04] ring-1 ring-amber-500/20 border-dashed",
                    !isSaved && !isDraft && "border-border/60 hover:border-foreground/20 hover:bg-foreground/[0.02]",
                    isSelected && !isDraft && !isSaved && "border-foreground/40 bg-foreground/[0.03] shadow-sm ring-1 ring-foreground/10",
                  )}
                >
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {isSaved && (
                      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-green-700 dark:text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Current
                      </span>
                    )}
                    {isDraft && (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="h-5 w-5 mb-3 flex items-center">
                    {p.customIcon ?? (Icon && <Icon className="h-5 w-5 text-foreground/80" weight="regular" />)}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{p.label}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{p.tagline}</div>
                </button>
              );
            })}
          </div>

          {isDirty && serverType !== "managed" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-foreground">
                <WarningDiamond className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" weight="fill" />
                <span>
                  Unsaved changes — previewing{" "}
                  <span className="font-semibold">{PROVIDERS.find((p) => p.value === serverType)?.label}</span>.
                  Changes don&apos;t take effect until you save.
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                <DesignButton variant="secondary" size="sm" onClick={handleDiscard} disabled={saving}>
                  Discard
                </DesignButton>
                <DesignButton
                  size="sm"
                  loading={saving}
                  disabled={!canSave && serverType !== "shared"}
                  onClick={() => runAsynchronouslyWithAlert(handleSave)}
                >
                  Save changes
                </DesignButton>
              </div>
            </div>
          )}

          {isShared && (
            <DesignAlert
              variant="info"
              description="On the shared server you can only send Stack's default emails. Custom templates, themes, and sender identity require your own provider."
            />
          )}

          {serverType === "managed" && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">Tracked managed domains</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Domains you own that we sign & deliver from.</div>
                </div>
                <DesignButton size="sm" className="gap-1.5" onClick={() => setDialog({ initialState: null })}>
                  <Plus className="h-3.5 w-3.5" /> Add domain
                </DesignButton>
              </div>

              {loadingDomains && domains.length === 0 ? (
                <div className="rounded-lg border border-border/60 p-6 flex items-center justify-center gap-2 text-muted-foreground">
                  <Spinner size={16} className="animate-spin" />
                  <span className="text-sm">Loading managed domains…</span>
                </div>
              ) : domains.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
                  <GlobeSimple size={24} className="mx-auto text-muted-foreground/50" />
                  <div className="text-sm font-medium text-foreground mt-2">No managed domains yet</div>
                  <div className="text-xs text-muted-foreground mt-1">Add your first domain to start sending from a custom sender.</div>
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 divide-y divide-border/50 overflow-hidden">
                  {domains.map((d) => {
                    const isInUse = d.domainId === activeManagedDomainId;
                    const isReadyButUnused = !isInUse && (d.status === "verified" || d.status === "applied");
                    const isPending = d.status === "pending_dns" || d.status === "pending_verification" || d.status === "failed";
                    const displayStatus: ManagedDomainStatus = isInUse ? "applied" : isReadyButUnused ? "verified" : d.status;
                    const displayLabel = isInUse ? "Active" : MANAGED_DOMAIN_STATUS_LABELS[displayStatus];
                    return (
                      <div key={d.domainId} className="flex items-center justify-between px-4 py-3 gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <GlobeSimple className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-mono text-foreground truncate">
                              {d.senderLocalPart}@{d.subdomain}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {isInUse ? "In use for this project" : "Not in use"}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn(
                            "text-[11px] font-medium px-2 py-0.5 rounded-full",
                            MANAGED_DOMAIN_STATUS_COLORS[displayStatus],
                          )}>
                            {displayLabel}
                          </span>
                          {isReadyButUnused && (
                            <DesignButton
                              size="sm"
                              variant="secondary"
                              onClick={() => runAsynchronouslyWithAlert(async () => {
                                await stackAdminApp.applyManagedEmailProvider({ domainId: d.domainId });
                                toast({ title: "Domain applied", description: `Sending from ${d.senderLocalPart}@${d.subdomain}.`, variant: "success" });
                                await refreshDomains();
                              })}
                            >
                              Use this domain
                            </DesignButton>
                          )}
                          {isPending && (
                            <DesignButton
                              size="sm"
                              variant="secondary"
                              onClick={() => setDialog({ initialState: {
                                domainId: d.domainId,
                                subdomain: d.subdomain,
                                senderLocalPart: d.senderLocalPart,
                                nameServerRecords: d.nameServerRecords,
                                status: d.status,
                              } })}
                            >
                              View DNS
                            </DesignButton>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(serverType === "resend" || serverType === "standard") && (
            <div className="space-y-4 pt-2">
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender Email</Label>
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
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sender Name</Label>
                  <DesignInput
                    value={formValues.senderName || ""}
                    onChange={(e) => updateField("senderName", e.target.value)}
                    type="text"
                    placeholder="Your App Name"
                    size="md"
                  />
                </div>
              </div>

              {serverType === "resend" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Resend API Key</Label>
                  <DesignInput
                    value={formValues.password || ""}
                    onChange={(e) => updateField("password", e.target.value)}
                    type="password"
                    placeholder="re_..."
                    size="md"
                  />
                </div>
              )}

              {serverType === "standard" && (
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {configFields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{field.label}</Label>
                      <DesignInput
                        value={formValues[field.key] || ""}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        type={field.type}
                        size="md"
                      />
                    </div>
                  ))}
                </div>
              )}

              {saveError && (
                <DesignAlert variant="error" description={saveError} />
              )}
            </div>
          )}
        </div>
      </DesignCard>

      <ManagedDomainSetupDialog
        open={dialog !== null}
        onOpenChange={(o) => { if (!o) setDialog(null); }}
        initialState={dialog?.initialState ?? null}
        onCompleted={() => { runAsynchronouslyWithAlert(refreshDomains); }}
      />
    </>
  );
}
