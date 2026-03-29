'use client';

import { AppIcon } from "@/components/app-square";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignBadge } from "@/components/design-components/badge";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { DesignInput } from "@/components/design-components/input";
import { DesignSelectorDropdown } from "@/components/design-components/select";
import { useRouter } from "@/components/router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  BrowserFrame,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Typography,
  cn,
} from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { getPublicEnvVar } from "@/lib/env";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  ChartBarIcon,
  CheckCircleIcon,
  LightningIcon,
  LinkBreakIcon,
  PlusCircleIcon,
  ShieldIcon,
  StripeLogoIcon,
  WalletIcon,
  WarningCircleIcon,
  WebhooksLogoIcon
} from "@phosphor-icons/react";
import { AdminOwnedProject, AuthPage, useStackApp, useUser } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { projectOnboardingStatusValues, type ProjectOnboardingStatus } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { runAsynchronouslyWithAlert, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PROJECT_ONBOARDING_STATUSES = projectOnboardingStatusValues;

type SignInMethod = "credential" | "magicLink" | "passkey" | "google" | "github" | "microsoft";

const SIGN_IN_METHODS: Array<{ id: SignInMethod, label: string }> = [
  { id: "credential", label: "Email & password" },
  { id: "magicLink", label: "Magic link / OTP" },
  { id: "passkey", label: "Passkey" },
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
];

const REQUIRED_APP_IDS: AppId[] = ["authentication", "emails"];
const PRIMARY_APP_IDS: AppId[] = ["authentication", "emails", "payments", "analytics"];
const ALL_APP_IDS = Object.keys(ALL_APPS) as AppId[];

type StackAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
  refreshOwnedProjects: () => Promise<void>,
};

type TimelineStep = {
  id: ProjectOnboardingStatus,
  label: string,
};

const PAYMENT_COUNTRY_OPTIONS = [
  { value: "US", label: "United States" },
  { value: "OTHER", label: "Other" },
] as const;

function isStackAppInternals(value: unknown): value is StackAppInternals {
  return (
    value != null
    && typeof value === "object"
    && "sendRequest" in value
    && typeof value.sendRequest === "function"
    && "refreshOwnedProjects" in value
    && typeof value.refreshOwnedProjects === "function"
  );
}

function getStackAppInternals(appValue: unknown): StackAppInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }

  const internals = Reflect.get(appValue, stackAppInternalsSymbol);
  if (!isStackAppInternals(internals)) {
    throw new Error("The Stack client app cannot send internal requests.");
  }

  return internals;
}

function isProjectOnboardingStatus(value: unknown): value is ProjectOnboardingStatus {
  return typeof value === "string" && PROJECT_ONBOARDING_STATUSES.some((status) => status === value);
}

function orderedAppIds() {
  const primarySet = new Set(PRIMARY_APP_IDS);
  const secondary = ALL_APP_IDS.filter((appId) => !primarySet.has(appId)).sort((a, b) => {
    return stringCompare(ALL_APPS[a].displayName, ALL_APPS[b].displayName);
  });
  return [...PRIMARY_APP_IDS, ...secondary];
}

function normalizeTrustedDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Trusted domain must be a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Trusted domain must start with http:// or https://.");
  }

  return parsed.toString().replace(/\/$/, "");
}

function buildTimeline(includePayments: boolean): TimelineStep[] {
  const timeline: TimelineStep[] = [
    { id: "config_choice", label: "Config" },
    { id: "apps_selection", label: "Apps" },
    { id: "auth_setup", label: "Auth" },
    { id: "email_theme_setup", label: "Email Theme" },
  ];

  if (includePayments) {
    timeline.push({ id: "payments_setup", label: "Payments" });
  }

  timeline.push({ id: "completed", label: "Finish" });
  return timeline;
}

function deriveInitialSignInMethods(project: AdminOwnedProject, status: ProjectOnboardingStatus): Set<SignInMethod> {
  const config = project.config;
  const methods = new Set<SignInMethod>();

  if (config.credentialEnabled) {
    methods.add("credential");
  }
  if (config.magicLinkEnabled) {
    methods.add("magicLink");
  }
  if (config.passkeyEnabled) {
    methods.add("passkey");
  }

  for (const provider of config.oauthProviders) {
    if (provider.id === "google" || provider.id === "github" || provider.id === "microsoft") {
      methods.add(provider.id);
    }
  }

  const hasDefaultUntouchedAuthConfig = (
    config.credentialEnabled
    && !config.magicLinkEnabled
    && !config.passkeyEnabled
    && config.oauthProviders.length === 0
  );
  const isInEarlyOnboardingStep = (
    status === "config_choice"
    || status === "apps_selection"
    || status === "auth_setup"
  );
  if (hasDefaultUntouchedAuthConfig && isInEarlyOnboardingStep) {
    methods.add("credential");
    methods.add("magicLink");
    methods.add("google");
  }

  return methods;
}

function deriveInitialApps(config: ReturnType<AdminOwnedProject["useConfig"]>): Set<AppId> {
  const enabledApps = new Set<AppId>();

  for (const appId of ALL_APP_IDS) {
    if (config.apps.installed[appId]?.enabled) {
      enabledApps.add(appId);
    }
  }

  if (enabledApps.size === 0) {
    for (const primaryAppId of PRIMARY_APP_IDS) {
      enabledApps.add(primaryAppId);
    }
  }

  for (const requiredAppId of REQUIRED_APP_IDS) {
    enabledApps.add(requiredAppId);
  }

  return enabledApps;
}

function getStepIndex(steps: TimelineStep[], stepId: ProjectOnboardingStatus) {
  return steps.findIndex((step) => step.id === stepId);
}

function OnboardingTimeline(props: {
  steps: TimelineStep[],
  currentStep: ProjectOnboardingStatus,
  onStepClick?: (step: ProjectOnboardingStatus) => void,
  disabled?: boolean,
}) {
  const currentIndex = props.steps.findIndex((step) => step.id === props.currentStep);

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex min-w-max items-center justify-center gap-2">
        {props.steps.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isClickable = isComplete && !props.disabled && props.onStepClick != null;
          const circleClassName = isComplete
            ? "bg-green-500 text-white"
            : isCurrent
              ? "bg-blue-600 text-white"
              : "bg-muted text-muted-foreground";

          return (
            <div className="flex items-center gap-2" key={step.id}>
              {isClickable ? (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 transition-colors duration-150 hover:transition-none hover:border-foreground/25 hover:bg-foreground/[0.03]"
                  onClick={() => props.onStepClick?.(step.id)}
                >
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                      circleClassName
                    )}
                  >
                    <CheckCircleIcon className="h-4 w-4" />
                  </div>
                  <span className={cn("text-sm", isCurrent ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5">
                  <div
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                      circleClassName
                    )}
                  >
                    {isComplete ? <CheckCircleIcon className="h-4 w-4" /> : index + 1}
                  </div>
                  <span className={cn("text-sm", isCurrent ? "font-semibold text-foreground" : "text-muted-foreground")}>{step.label}</span>
                </div>
              )}
              {index < props.steps.length - 1 && <div className="h-px w-8 bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function appStageBadgeColor(stage: (typeof ALL_APPS)[AppId]["stage"]) {
  if (stage === "alpha") {
    return "orange";
  }
  if (stage === "beta") {
    return "blue";
  }
  return null;
}

function appStageLabel(stage: (typeof ALL_APPS)[AppId]["stage"]) {
  if (stage === "alpha") {
    return "Alpha";
  }
  if (stage === "beta") {
    return "Beta";
  }
  return null;
}

function OnboardingAppCard(props: {
  appId: AppId,
  selected: boolean,
  required: boolean,
  primary: boolean,
  disabled?: boolean,
  onToggle: () => void,
}) {
  const app = ALL_APPS[props.appId];
  const stageBadgeColor = appStageBadgeColor(app.stage);
  const stageLabel = appStageLabel(app.stage);

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={props.onToggle}
          disabled={props.disabled}
          className={cn(
            "group relative w-full overflow-hidden rounded-2xl border transition-[transform,background-color,border-color,box-shadow] duration-150 hover:transition-none",
            props.primary ? "min-h-[136px] px-4 py-4" : "min-h-[108px] px-3 py-3",
            props.selected
              ? "border-blue-500/45 bg-blue-500/[0.05] shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
              : "border-border bg-background/80 hover:border-foreground/20 hover:bg-foreground/[0.03]",
            "active:scale-[0.99]",
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-blue-500/[0.03] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:transition-none" />
          {props.selected && (
            <div className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
              <CheckCircleIcon className="h-4 w-4" weight="fill" />
            </div>
          )}
          {props.primary ? (
            <div className="relative flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex w-full items-center justify-center">
                <div className="scale-[0.72] rounded-2xl">
                  <AppIcon appId={props.appId} enabled={props.selected} />
                </div>
              </div>

              <div className="w-full space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <Typography className="text-base font-semibold leading-tight">
                    {app.displayName}
                  </Typography>
                </div>
                <div className="flex min-h-6 items-center justify-center gap-2">
                  {props.required && (
                    <DesignBadge label="Required" color="green" size="sm" />
                  )}
                  {!props.required && stageBadgeColor && stageLabel && (
                    <DesignBadge
                      label={stageLabel}
                      color={stageBadgeColor}
                      size="sm"
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex h-full flex-col items-center justify-center gap-2 text-center">
              <div className="shrink-0 scale-[0.56]">
                <AppIcon appId={props.appId} enabled={props.selected} />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex items-center justify-center gap-1.5">
                  <Typography className="truncate text-[11px] font-medium leading-tight">
                    {app.displayName}
                  </Typography>
                </div>
                <div className="flex min-h-5 items-center justify-center gap-1.5">
                  {props.required && (
                    <DesignBadge label="Required" color="green" size="sm" />
                  )}
                  {!props.required && stageBadgeColor && stageLabel && (
                    <DesignBadge
                      label={stageLabel}
                      color={stageBadgeColor}
                      size="sm"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="z-50 max-w-xs rounded-2xl border border-white/[0.08] bg-background/95 p-4 backdrop-blur-xl"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Typography className="text-sm font-semibold">{app.displayName}</Typography>
            {stageBadgeColor && (
              <DesignBadge
                label={app.stage === "alpha" ? "Alpha" : "Beta"}
                color={stageBadgeColor}
                size="sm"
              />
            )}
          </div>
          <Typography variant="secondary" className="text-xs leading-relaxed">
            {app.subtitle}
          </Typography>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function OnboardingEmailThemePreview(props: {
  adminApp: AdminOwnedProject["app"],
  themeId: string,
}) {
  const previewHtml = props.adminApp.useEmailPreview({
    themeId: props.themeId,
    templateTsxSource: previewTemplateSource,
  });

  return (
    <iframe
      srcDoc={previewHtml}
      sandbox=""
      className="pointer-events-none h-full w-full border-0"
      title="Email theme preview"
    />
  );
}

function ModeNotImplementedCard(props: { onBack: () => void }) {
  return (
    <DesignCard
      className="w-full"
      title="Link Existing Config"
      subtitle="This feature has not been implemented yet."
      icon={LinkBreakIcon}
      gradient="default"
      glassmorphic
      contentClassName="flex min-h-[420px] flex-col justify-between gap-6"
    >
      <DesignAlert
        variant="warning"
        title="Not available yet"
        description="Linking an existing config into the onboarding flow is on the roadmap. You can go back and continue with Create New."
        glassmorphic
      />
      <div className="mt-6 flex justify-end">
        <DesignButton variant="outline" className="rounded-xl" onClick={props.onBack}>
          Go Back
        </DesignButton>
      </div>
    </DesignCard>
  );
}

function ProjectOnboardingWizard(props: {
  project: AdminOwnedProject,
  status: ProjectOnboardingStatus,
  mode: string | null,
  setMode: (mode: string | null) => void,
  setStatus: (status: ProjectOnboardingStatus) => Promise<void>,
  onComplete: () => void,
}) {
  const router = useRouter();
  const { project, status, setMode, setStatus, onComplete } = props;
  const completeConfig = project.useConfig();
  const updateConfig = useUpdateConfig();
  const setProjectOnboardingStatus = setStatus;
  const finishProjectOnboarding = onComplete;
  const [saving, setSaving] = useState(false);
  const [selectedApps, setSelectedApps] = useState<Set<AppId>>(() => deriveInitialApps(completeConfig));
  const [signInMethods, setSignInMethods] = useState<Set<SignInMethod>>(() => deriveInitialSignInMethods(project, status));
  const [trustedDomain, setTrustedDomain] = useState("");
  const [domainHandlerPath, setDomainHandlerPath] = useState("/handler");
  const [managedSubdomain, setManagedSubdomain] = useState("");
  const [managedSenderLocalPart, setManagedSenderLocalPart] = useState("");
  const [managedDomainSetupStatus, setManagedDomainSetupStatus] = useState<string | null>(null);
  const [requiredAppsNotice, setRequiredAppsNotice] = useState<string | null>(null);
  const [selectedEmailThemeId, setSelectedEmailThemeId] = useState(completeConfig.emails.selectedThemeId);
  const [selectedPaymentsCountry, setSelectedPaymentsCountry] = useState("US");
  const [selectedConfigChoice, setSelectedConfigChoice] = useState<"create-new" | "link-existing">("create-new");
  const previousProjectId = useRef<string | null>(null);

  const runWithSaving = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true);
    try {
      await fn();
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (previousProjectId.current === project.id) {
      return;
    }
    previousProjectId.current = project.id;

    setSelectedApps(deriveInitialApps(completeConfig));
    setSignInMethods(deriveInitialSignInMethods(project, status));

    const trustedDomains = Object.values(completeConfig.domains.trustedDomains)
      .filter((entry) => entry.baseUrl != null)
      .map((entry) => ({ baseUrl: entry.baseUrl, handlerPath: entry.handlerPath }));

    if (trustedDomains[0]) {
      const trustedDomainEntry = trustedDomains[0];
      if (trustedDomainEntry.baseUrl == null) {
        throw new Error("Invariant violated: trusted domain entry is missing a baseUrl.");
      }
      setTrustedDomain(trustedDomainEntry.baseUrl);
      setDomainHandlerPath(trustedDomainEntry.handlerPath);
    } else {
      setTrustedDomain("");
      setDomainHandlerPath("/handler");
    }

    const serverConfig = completeConfig.emails.server;
    setManagedSubdomain(serverConfig.managedSubdomain ?? "");
    setManagedSenderLocalPart(serverConfig.managedSenderLocalPart ?? "");
    setSelectedEmailThemeId(completeConfig.emails.selectedThemeId);
    setManagedDomainSetupStatus(null);
    setRequiredAppsNotice(null);
    setSelectedConfigChoice("create-new");
  }, [completeConfig, project, project.id, status]);

  const emailThemes = project.app.useEmailThemes();
  const includePayments = selectedApps.has("payments") || status === "payments_setup" || completeConfig.apps.installed.payments?.enabled === true;
  const timelineSteps = useMemo(() => buildTimeline(includePayments), [includePayments]);
  const currentTimelineIndex = useMemo(() => getStepIndex(timelineSteps, status), [status, timelineSteps]);

  const handleTimelineStepClick = useCallback((step: ProjectOnboardingStatus) => {
    const targetIndex = getStepIndex(timelineSteps, step);
    if (targetIndex < 0 || targetIndex >= currentTimelineIndex) {
      return;
    }

    runAsynchronouslyWithAlert(async () => {
      if (step === "config_choice") {
        setMode(null);
      }
      await setStatus(step);
    });
  }, [currentTimelineIndex, setMode, setStatus, timelineSteps]);

  useEffect(() => {
    if (status !== "domain_setup") {
      return;
    }

    runAsynchronouslyWithAlert(async () => {
      await setStatus("email_theme_setup");
    });
  }, [setStatus, status]);

  const authPreviewProject = useMemo(() => {
    return {
      id: project.id,
      config: {
        signUpEnabled: true,
        credentialEnabled: signInMethods.has("credential"),
        magicLinkEnabled: signInMethods.has("magicLink"),
        passkeyEnabled: signInMethods.has("passkey"),
        oauthProviders: (allProviders as readonly string[])
          .filter((providerId) => signInMethods.has(providerId as SignInMethod))
          .map((providerId) => ({ id: providerId, type: "shared" as const })),
      },
    };
  }, [project.id, signInMethods]);

  const toggleSignInMethod = (method: SignInMethod, enabled: boolean) => {
    setSignInMethods((previous) => {
      const next = new Set(previous);
      if (enabled) {
        next.add(method);
      } else {
        next.delete(method);
      }
      return next;
    });
  };

  const toggleApp = (appId: AppId) => {
    setSelectedApps((previous) => {
      const next = new Set(previous);
      if (REQUIRED_APP_IDS.includes(appId)) {
        if (next.has(appId)) {
          setRequiredAppsNotice(`${ALL_APPS[appId].displayName} is required during onboarding and can't be turned off.`);
        }
        next.add(appId);
        return next;
      }

      setRequiredAppsNotice(null);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const finalizeOnboarding = useCallback(async () => {
    await runWithSaving(async () => {
      await setProjectOnboardingStatus("completed");
      finishProjectOnboarding();
    });
  }, [finishProjectOnboarding, runWithSaving, setProjectOnboardingStatus]);

  if (props.status === "config_choice" && props.mode === "link-existing") {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col min-h-0 space-y-5 px-4 py-6 md:px-8">
        <OnboardingTimeline
          steps={timelineSteps}
          currentStep="config_choice"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <ModeNotImplementedCard
            onBack={() => {
              props.setMode(null);
              setSelectedConfigChoice("create-new");
            }}
          />
        </div>
      </div>
    );
  }

  if (props.status === "config_choice") {
    const createNewSelected = selectedConfigChoice === "create-new";
    const linkExistingSelected = selectedConfigChoice === "link-existing";

    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col min-h-0 space-y-5 px-4 py-6 md:px-8">
        <OnboardingTimeline
          steps={timelineSteps}
          currentStep="config_choice"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
        />
        <DesignCard
          className="flex min-h-0 flex-1 flex-col w-full"
          title="Choose How You Want To Start"
          subtitle="Create a fresh Stack Auth config, or link an existing config file."
          icon={LightningIcon}
          gradient="blue"
          glassmorphic
          contentClassName="flex min-h-[calc(100vh-220px)] flex-1 flex-col gap-6"
          actions={
            <DesignButton
              className="rounded-xl"
              loading={saving}
              onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                if (selectedConfigChoice === "create-new") {
                  await props.setStatus("apps_selection");
                } else {
                  props.setMode("link-existing");
                }
              }))}
            >
              Next
            </DesignButton>
          }
        >
          <div className="grid min-h-[280px] flex-1 gap-4 md:grid-cols-2">
            <button
              type="button"
              className={cn(
                "group relative flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-3xl border p-6 text-center transition-colors duration-150 hover:transition-none",
                createNewSelected
                  ? "border-blue-500/45 bg-blue-500/[0.06] shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                  : "border-black/[0.08] bg-background/70 hover:bg-foreground/[0.03] dark:border-white/[0.08]",
              )}
              onClick={() => setSelectedConfigChoice("create-new")}
              disabled={saving}
            >
              {createNewSelected && (
                <div className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
                  <CheckCircleIcon className="h-4 w-4" weight="fill" />
                </div>
              )}
              <div className="flex flex-col items-center gap-4 text-center">
                <div
                  className={cn(
                    "w-fit rounded-xl p-2",
                    createNewSelected ? "bg-blue-500/10 text-blue-600" : "bg-foreground/[0.05] text-muted-foreground",
                  )}
                >
                  <LightningIcon className="h-6 w-6" />
                </div>
                <div className="space-y-2">
                  <Typography type="h3">Create New</Typography>
                  <Typography variant="secondary">Start from curated defaults and configure apps step-by-step.</Typography>
                </div>
              </div>
            </button>

            <button
              type="button"
              className={cn(
                "group relative flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-3xl border p-6 text-center transition-colors duration-150 hover:transition-none",
                linkExistingSelected
                  ? "border-blue-500/45 bg-blue-500/[0.06] shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                  : "border-black/[0.08] bg-background/70 hover:bg-foreground/[0.03] dark:border-white/[0.08]",
              )}
              onClick={() => setSelectedConfigChoice("link-existing")}
              disabled={saving}
            >
              {linkExistingSelected && (
                <div className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
                  <CheckCircleIcon className="h-4 w-4" weight="fill" />
                </div>
              )}
              <div className="flex flex-col items-center gap-4 text-center">
                <div
                  className={cn(
                    "w-fit rounded-xl p-2",
                    linkExistingSelected ? "bg-blue-500/10 text-blue-600" : "bg-foreground/[0.05] text-muted-foreground",
                  )}
                >
                  <LinkBreakIcon className="h-6 w-6" />
                </div>
                <div className="space-y-2">
                  <Typography type="h3">Link Existing Config</Typography>
                  <Typography variant="secondary">Bring an existing config into this project.</Typography>
                </div>
              </div>
            </button>
          </div>
        </DesignCard>
      </div>
    );
  }

  if (props.status === "apps_selection") {
    const orderedIds = orderedAppIds();
    const primaryAppIds = orderedIds.filter((appId) => PRIMARY_APP_IDS.includes(appId));
    const secondaryAppIds = orderedIds.filter((appId) => !PRIMARY_APP_IDS.includes(appId));

    return (
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-8">
        <OnboardingTimeline
          steps={timelineSteps}
          currentStep="apps_selection"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
        />
        <DesignCard
          className="w-full"
          title="Select Apps"
          subtitle="Authentication, Emails, Payments, and Analytics are selected by default. Authentication and Emails are required."
          icon={LightningIcon}
          gradient="cyan"
          glassmorphic
          contentClassName="space-y-6"
          actions={
            <DesignButton
              className="rounded-xl"
              loading={saving}
              onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                const appConfigUpdateEntries = new Map(
                  ALL_APP_IDS.map((appId) => [
                    `apps.installed.${appId}.enabled`,
                    selectedApps.has(appId),
                  ])
                );

                const configUpdated = await updateConfig({
                  adminApp: props.project.app,
                  configUpdate: Object.fromEntries(appConfigUpdateEntries),
                  pushable: true,
                });
                if (!configUpdated) {
                  return;
                }
                await props.setStatus("auth_setup");
              }))}
            >
              Next
            </DesignButton>
          }
        >
          <TooltipProvider delayDuration={0}>
            <div className="space-y-6">
              {requiredAppsNotice && (
                <DesignAlert
                  variant="info"
                  title="Required app"
                  description={requiredAppsNotice}
                  glassmorphic
                />
              )}

              <div className="mx-auto max-w-2xl space-y-2 text-center">
                <Typography className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  Select apps
                </Typography>
                <Typography variant="secondary" className="text-sm">
                  Start with the core Stack Auth apps now. You can enable or disable the rest later.
                </Typography>
              </div>

              <div className="mx-auto w-full max-w-5xl space-y-4">
                <div className="flex items-center justify-center">
                  <DesignBadge label="Core apps" color="blue" size="sm" />
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {primaryAppIds.map((appId) => (
                    <OnboardingAppCard
                      key={appId}
                      appId={appId}
                      selected={selectedApps.has(appId)}
                      required={REQUIRED_APP_IDS.includes(appId)}
                      primary
                      disabled={saving}
                      onToggle={() => toggleApp(appId)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Typography className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    More apps
                  </Typography>
                </div>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
                >
                  {secondaryAppIds.map((appId) => (
                    <OnboardingAppCard
                      key={appId}
                      appId={appId}
                      selected={selectedApps.has(appId)}
                      required={REQUIRED_APP_IDS.includes(appId)}
                      primary={false}
                      disabled={saving}
                      onToggle={() => toggleApp(appId)}
                    />
                  ))}
                </div>
              </div>

              <Typography variant="secondary" className="text-xs">
                Core apps are ready by default, and required apps stay enabled through onboarding.
              </Typography>
            </div>
          </TooltipProvider>
        </DesignCard>
      </div>
    );
  }

  if (props.status === "auth_setup") {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-8">
        <OnboardingTimeline
          steps={timelineSteps}
          currentStep="auth_setup"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
        />
        <DesignCard
          className="w-full"
          title="Configure Authentication"
          subtitle="Choose sign-in methods and preview your sign-in page."
          icon={CheckCircleIcon}
          gradient="blue"
          glassmorphic
          contentClassName="flex min-h-[520px] flex-col gap-6"
          actions={
            <DesignButton
              className="rounded-xl"
              loading={saving}
              onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                if (signInMethods.size === 0) {
                  throw new Error("Select at least one sign-in method before continuing.");
                }

                const authMethodsUpdated = await updateConfig({
                  adminApp: props.project.app,
                  configUpdate: {
                    "auth.password.allowSignIn": signInMethods.has("credential"),
                    "auth.otp.allowSignIn": signInMethods.has("magicLink"),
                    "auth.passkey.allowSignIn": signInMethods.has("passkey"),
                  },
                  pushable: true,
                });

                if (!authMethodsUpdated) {
                  return;
                }

                const providersUpdated = await updateConfig({
                  adminApp: props.project.app,
                  configUpdate: {
                    "auth.oauth.providers.google": signInMethods.has("google") ? {
                      type: "google",
                      isShared: true,
                      allowSignIn: true,
                      allowConnectedAccounts: true,
                    } : null,
                    "auth.oauth.providers.github": signInMethods.has("github") ? {
                      type: "github",
                      isShared: true,
                      allowSignIn: true,
                      allowConnectedAccounts: true,
                    } : null,
                    "auth.oauth.providers.microsoft": signInMethods.has("microsoft") ? {
                      type: "microsoft",
                      isShared: true,
                      allowSignIn: true,
                      allowConnectedAccounts: true,
                    } : null,
                  },
                  pushable: false,
                });

                if (!providersUpdated) {
                  return;
                }

                await props.setStatus("email_theme_setup");
              }))}
            >
              Next
            </DesignButton>
          }
        >
          <div className="grid flex-1 overflow-hidden rounded-2xl border border-black/[0.08] bg-background/70 dark:border-white/[0.08] xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex items-center justify-center px-6 py-8">
              <div className="w-full max-w-[280px] space-y-5">
                <div className="space-y-2">
                  <Typography type="h3">Sign-in methods</Typography>
                  <Typography variant="secondary" className="text-sm">
                    More sign-in methods are available on the dashboard later.
                  </Typography>
                </div>

                <div className="rounded-2xl border border-black/[0.08] bg-background/80 dark:border-white/[0.08]">
                  {SIGN_IN_METHODS.map((method, index) => {
                    const checked = signInMethods.has(method.id);
                    return (
                      <label
                        key={method.id}
                        className={cn(
                          "flex items-center justify-between gap-4 px-4 py-3",
                          index !== SIGN_IN_METHODS.length - 1 && "border-b border-black/[0.06] dark:border-white/[0.06]",
                        )}
                      >
                        <span className="text-sm">{method.label}</span>
                        <Switch
                          checked={checked}
                          onCheckedChange={(nextChecked) => toggleSignInMethod(method.id, nextChecked)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="hidden items-center justify-center bg-zinc-300 px-2 py-8 dark:bg-zinc-800 md:flex lg:px-4">
              <div className="flex w-full max-w-[1480px] items-center justify-center">
                <BrowserFrame url="your-website.com/signin" className="w-full">
                  <div className="flex min-h-[420px] items-center justify-center px-6 py-8">
                    <div className="pointer-events-none relative flex w-full items-center justify-center" inert>
                      <div className="absolute inset-0 z-10 bg-transparent" />
                      <AuthPage type="sign-in" mockProject={authPreviewProject} />
                    </div>
                  </div>
                </BrowserFrame>
              </div>
            </div>
          </div>
        </DesignCard>
      </div>
    );
  }

  if (props.status === "domain_setup") {
    return (
      <div className="flex w-full min-h-[320px] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (props.status === "email_theme_setup") {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 md:px-8">
        <OnboardingTimeline
          steps={timelineSteps}
          currentStep="email_theme_setup"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
        />
        <DesignCard
          className="w-full"
          title="Select Email Theme"
          subtitle="Choose from existing themes. You can continue without changing the default theme."
          icon={CheckCircleIcon}
          gradient="purple"
          glassmorphic
          contentClassName="flex min-h-[520px] flex-col gap-6"
          actions={
            <DesignButton
              className="rounded-xl"
              loading={saving}
              onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                if (selectedEmailThemeId !== completeConfig.emails.selectedThemeId) {
                  const configUpdated = await updateConfig({
                    adminApp: props.project.app,
                    configUpdate: {
                      "emails.selectedThemeId": selectedEmailThemeId,
                    },
                    pushable: true,
                  });
                  if (!configUpdated) {
                    return;
                  }
                }

                if (includePayments) {
                  await props.setStatus("payments_setup");
                } else {
                  await props.setStatus("completed");
                    props.onComplete();
                }
              }))}
            >
              {includePayments ? "Next" : "Finish"}
            </DesignButton>
          }
        >
          <div className="flex-1 space-y-4">
            {emailThemes.length === 0 && (
              <DesignAlert
                variant="warning"
                title="No themes found"
                description="Theme selection is temporarily unavailable. You can still continue."
                glassmorphic
              />
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              {emailThemes.map((theme) => {
                const isSelected = selectedEmailThemeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setSelectedEmailThemeId(theme.id)}
                    className={cn(
                      "group relative overflow-hidden rounded-3xl border text-left transition-[border-color,background-color,box-shadow] duration-150 hover:transition-none",
                      isSelected
                        ? "border-blue-500/45 bg-blue-500/[0.06] shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                        : "border-border bg-background/70 hover:border-foreground/20 hover:bg-foreground/[0.03]",
                    )}
                  >
                    {isSelected && (
                      <div className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white shadow-sm">
                        <CheckCircleIcon className="h-4 w-4" weight="fill" />
                      </div>
                    )}
                    <div className="aspect-[4/3] overflow-hidden border-b border-border bg-background">
                      <div style={{ transform: "scale(0.5)", transformOrigin: "top left", width: "200%", height: "200%" }}>
                        <OnboardingEmailThemePreview adminApp={props.project.app} themeId={theme.id} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 p-4">
                      <Typography type="h4">{theme.displayName}</Typography>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </DesignCard>
      </div>
    );
  }

  if (props.status === "payments_setup") {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-8">
        <OnboardingTimeline
          steps={timelineSteps}
          currentStep="payments_setup"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
        />
        <DesignCard
          className="w-full"
          title="Payments Onboarding"
          subtitle="Use the same Stripe setup flow as the Payments app. Payments is currently supported in the United States only."
          icon={StripeLogoIcon}
          gradient="orange"
          glassmorphic
          contentClassName="flex min-h-[420px] flex-col gap-6"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedPaymentsCountry !== "US" && (
                <DesignButton
                  className="rounded-xl"
                  variant="outline"
                  onClick={() => setSelectedPaymentsCountry("US")}
                >
                  <ArrowLeftIcon className="mr-2 h-4 w-4" />
                  Back
                </DesignButton>
              )}
              <DesignButton
                className="rounded-xl"
                variant="outline"
                loading={saving}
                onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                  await finalizeOnboarding();
                }))}
              >
                Do This Later
              </DesignButton>
              {selectedPaymentsCountry === "US" && (
                <DesignButton
                  className="rounded-xl"
                  loading={saving}
                  onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                    const setup = await props.project.app.setupPayments();
                    const redirectUrl = new URL(setup.url);
                    if (redirectUrl.protocol !== "https:") {
                      throw new Error("Payments setup redirect URL must use HTTPS.");
                    }
                    window.location.href = redirectUrl.toString();
                  }))}
                >
                  Continue Onboarding
                </DesignButton>
              )}
            </div>
          }
        >
          <div className="flex-1 space-y-6">
            <div className="mx-auto max-w-sm">
              <div className="rounded-3xl border border-border bg-background/70 p-8 text-center">
                <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                  <WalletIcon className="h-6 w-6" />
                </div>
                <Typography type="h3" className="mb-4">Setup Payments</Typography>
                <Typography type="p" variant="secondary" className="mt-2">
                  Let your users pay seamlessly and securely.
                </Typography>
                <ul className="mt-6 grid gap-3 text-left text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <WebhooksLogoIcon className="h-4 w-4 text-primary" />
                    <span>No webhooks or syncing</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <ArrowsClockwiseIcon className="h-4 w-4 text-primary" />
                    <span>One-time and recurring</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <ChartBarIcon className="h-4 w-4 text-primary" />
                    <span>Usage-based billing</span>
                  </li>
                </ul>
                <div className="mt-8 space-y-3 text-left">
                  <Label htmlFor="payments-country">Country of residence</Label>
                  <Select value={selectedPaymentsCountry} onValueChange={setSelectedPaymentsCountry}>
                    <SelectTrigger id="payments-country" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_COUNTRY_OPTIONS.map((country) => (
                        <SelectItem key={country.value} value={country.value}>
                          {country.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <ShieldIcon className="h-3.5 w-3.5" />
                  <span>Powered by Stripe</span>
                </div>
              </div>
            </div>

            {selectedPaymentsCountry === "US" ? (
              <DesignAlert
                variant="info"
                title="Payments is available in your country!"
                description="You will be redirected to Stripe, our partner for payment processing, to connect your bank account. Or, you can do this later and stay in test transactions for now."
                glassmorphic
              />
            ) : (
              <DesignAlert
                variant="warning"
                title="Payments is not available in your country yet"
                description="Stack Auth Payments is currently only available in the United States."
                glassmorphic
              />
            )}
          </div>
        </DesignCard>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <Alert>
        <WarningCircleIcon className="h-4 w-4" />
        <AlertTitle>Unknown onboarding step</AlertTitle>
        <AlertDescription>
          This project has an unknown onboarding state. Open the project directly and continue from the dashboard.
        </AlertDescription>
      </Alert>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => router.push(`/projects/${encodeURIComponent(props.project.id)}`)}>Open Project</Button>
      </div>
    </div>
  );
}

export default function PageClient() {
  const app = useStackApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const teams = user.useTeams();
  const projects = user.useOwnedProjects();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";

  const selectedProjectId = searchParams.get("project_id");
  const displayNameFromSearch = searchParams.get("display_name");
  const redirectToNeonConfirmWith = searchParams.get("redirect_to_neon_confirm_with");
  const redirectToConfirmWith = searchParams.get("redirect_to_confirm_with");
  const mode = searchParams.get("mode");
  const linkExistingBaitCapturedRef = useRef(false);

  const [projectStatuses, setProjectStatuses] = useState<Map<string, ProjectOnboardingStatus>>(new Map());
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [projectName, setProjectName] = useState(displayNameFromSearch ?? "");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(true);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  useEffect(() => {
    if (selectedTeamId != null) {
      return;
    }

    if (user.selectedTeam != null) {
      setSelectedTeamId(user.selectedTeam.id);
      return;
    }

    const firstTeam = teams.at(0);
    if (firstTeam !== undefined) {
      setSelectedTeamId(firstTeam.id);
    }
  }, [selectedTeamId, teams, user.selectedTeam]);

  const updateSearchParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value.length === 0) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    router.replace(query.length > 0 ? `/new-project?${query}` : "/new-project");
  }, [router, searchParams]);

  useEffect(() => {
    if (mode !== "link-existing" || linkExistingBaitCapturedRef.current) {
      return;
    }

    linkExistingBaitCapturedRef.current = true;
    captureError("new-project-link-existing-bait-engaged", new Error("bait engaged"));
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      setLoadingStatuses(true);
      try {
        const response = await appInternals.sendRequest("/internal/projects", {}, "client");
        if (!response.ok) {
          throw new Error(`Failed to load projects: ${response.status} ${await response.text()}`);
        }

        const body = await response.json();
        if (body == null || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items)) {
          throw new Error("Project list endpoint returned an invalid response.");
        }

        const statusMap = new Map<string, ProjectOnboardingStatus>();
        for (const item of body.items) {
          if (item == null || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
            continue;
          }

          const onboardingStatus = "onboarding_status" in item ? item.onboarding_status : undefined;
          if (!isProjectOnboardingStatus(onboardingStatus)) {
            throw new Error(`Project ${item.id} returned an invalid onboarding status.`);
          }
          statusMap.set(item.id, onboardingStatus);
        }

        if (!cancelled) {
          setProjectStatuses(statusMap);
        }
      } finally {
        if (!cancelled) {
          setLoadingStatuses(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appInternals, projects.length]);

  const selectedProject = useMemo(() => {
    if (selectedProjectId == null) {
      return null;
    }
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const selectedProjectStatus = useMemo(() => {
    if (selectedProjectId == null) {
      return null;
    }
    return projectStatuses.get(selectedProjectId) ?? null;
  }, [projectStatuses, selectedProjectId]);

  useEffect(() => {
    if (selectedProject == null || loadingStatuses || selectedProjectStatus !== "completed") {
      return;
    }

    router.replace(`/projects/${encodeURIComponent(selectedProject.id)}`);
  }, [loadingStatuses, router, selectedProject, selectedProjectStatus]);

  const setSelectedProjectStatus = async (project: AdminOwnedProject, status: ProjectOnboardingStatus) => {
    const projectInternals = getStackAppInternals(project.app);

    const response = await projectInternals.sendRequest(
      "/internal/projects/current",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ onboarding_status: status }),
      },
      "admin",
    );

    if (!response.ok) {
      throw new Error(`Failed to update onboarding status: ${response.status} ${await response.text()}`);
    }

    setProjectStatuses((previous) => {
      const next = new Map(previous);
      next.set(project.id, status);
      return next;
    });

    await appInternals.refreshOwnedProjects();
  };

  if (isLocalEmulator) {
    return (
      <div className="w-full flex-grow flex items-center justify-center p-4">
        <div className="max-w-lg w-full rounded-lg border border-border p-6 space-y-4">
          <Typography type="h2">Project creation is disabled in local emulator mode</Typography>
          <Typography variant="secondary">
            Use the <b>Open config file</b> action on the Projects page to open or create projects from a local config file path.
          </Typography>
          <div className="flex justify-end">
            <Button onClick={async () => {
              router.push("/projects");
              await wait(2000);
            }}>
              Go to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loadingStatuses && selectedProjectId != null) {
    return (
      <div className="flex w-full flex-grow items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (selectedProjectId != null && selectedProject == null) {
    return (
      <div className="w-full flex-grow flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Project not found</CardTitle>
            <CardDescription>We could not find the project in your account.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end">
            <Button variant="outline" onClick={() => router.push("/projects")}>Go to Projects</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedProject != null && !loadingStatuses && selectedProjectStatus === "completed") {
    return (
      <div className="flex w-full flex-grow items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (selectedProject != null && !loadingStatuses && selectedProjectStatus == null) {
    throw new Error(`Missing onboarding status for project ${selectedProject.id}.`);
  }

  if (selectedProject == null) {
    return (
      <div className="flex w-full flex-grow items-center justify-center">
        <Dialog
          open={isCreateProjectOpen}
          onOpenChange={(open) => {
            setIsCreateProjectOpen(open);
            if (!open) {
              router.push("/projects");
            }
          }}
        >
          <DialogContent
            className="overflow-hidden border-0 bg-white/90 p-0 shadow-2xl backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-background/75 dark:ring-white/[0.08] sm:max-w-[720px] sm:rounded-3xl"
            overlayProps={{ className: "bg-black/70 backdrop-blur-[2px]" }}
            noCloseButton
          >
            <DialogHeader className="border-b border-black/[0.08] px-6 py-6 text-left dark:border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-500/10 p-2.5 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  <PlusCircleIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-xl font-semibold tracking-tight">Create a new project</DialogTitle>
                </div>
              </div>
              <DialogDescription>
                Start by naming your project and choosing the team that will own it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-6 py-6">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <DesignInput
                  id="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="My Project"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="team-id">Team</Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <DesignSelectorDropdown
                    value={selectedTeamId ?? ""}
                    onValueChange={setSelectedTeamId}
                    placeholder="Select a team"
                    size="md"
                    className="w-full"
                    options={teams.map((team) => ({ value: team.id, label: team.displayName }))}
                  />
                  <DesignButton variant="outline" onClick={() => setIsCreateTeamOpen(true)} className="rounded-xl sm:min-w-[152px]">
                    <PlusCircleIcon className="mr-2 h-4 w-4" />
                    Create Team
                  </DesignButton>
                </div>
              </div>
            </div>

            <DialogFooter className="border-t border-black/[0.08] px-6 py-4 dark:border-white/[0.08] sm:justify-end sm:space-x-2">
              <DesignButton variant="outline" className="rounded-xl" onClick={() => router.push("/projects")} disabled={creatingProject}>
                Cancel
              </DesignButton>
              <DesignButton
                className="rounded-xl"
                loading={creatingProject}
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  const trimmedProjectName = projectName.trim();
                  if (trimmedProjectName.length === 0) {
                    throw new Error("Project name is required.");
                  }

                  const firstTeam = teams.at(0);
                  const teamId = selectedTeamId ?? user.selectedTeam?.id ?? firstTeam?.id;
                  if (teamId === undefined) {
                    throw new Error("Select a team before creating the project.");
                  }

                  setCreatingProject(true);
                  try {
                    const newProject = await user.createProject({
                      displayName: trimmedProjectName,
                      teamId,
                      onboardingStatus: "config_choice",
                    });

                    setProjectStatuses((previous) => {
                      const next = new Map(previous);
                      next.set(newProject.id, "config_choice");
                      return next;
                    });

                    if (redirectToNeonConfirmWith != null) {
                      const confirmSearchParams = new URLSearchParams(redirectToNeonConfirmWith);
                      confirmSearchParams.set("default_selected_project_id", newProject.id);
                      router.push(`/integrations/neon/confirm?${confirmSearchParams.toString()}`);
                      await wait(2000);
                      return;
                    }

                    if (redirectToConfirmWith != null) {
                      const confirmSearchParams = new URLSearchParams(redirectToConfirmWith);
                      confirmSearchParams.set("default_selected_project_id", newProject.id);
                      router.push(`/integrations/custom/confirm?${confirmSearchParams.toString()}`);
                      await wait(2000);
                      return;
                    }

                    updateSearchParams({
                      project_id: newProject.id,
                      mode: null,
                    });
                  } finally {
                    setCreatingProject(false);
                  }
                })}
              >
                Create Project
              </DesignButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isCreateTeamOpen} onOpenChange={setIsCreateTeamOpen}>
          <DialogContent
            className="overflow-hidden border-0 bg-white/90 p-0 shadow-2xl backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-background/75 dark:ring-white/[0.08] sm:max-w-[640px] sm:rounded-3xl"
            overlayProps={{ className: "bg-black/70 backdrop-blur-[2px]" }}
            noCloseButton
          >
            <DialogHeader className="px-6 pb-0 pt-6 text-left">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-500/10 p-2.5 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  <PlusCircleIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-xl font-semibold tracking-tight">Create Team</DialogTitle>
                </div>
              </div>
              <DialogDescription>
                This team will be available immediately for project ownership.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-6 py-6">
              <div className="space-y-2">
                <Label htmlFor="new-team-name">Team name</Label>
                <DesignInput
                  id="new-team-name"
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  placeholder="Acme Team"
                />
              </div>
            </div>

            <DialogFooter className="px-6 pb-6 pt-0 sm:justify-end sm:space-x-2">
              <DesignButton variant="outline" className="rounded-xl" onClick={() => setIsCreateTeamOpen(false)} disabled={creatingTeam}>
                Cancel
              </DesignButton>
              <DesignButton
                className="rounded-xl"
                loading={creatingTeam}
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  const trimmedTeamName = newTeamName.trim();
                  if (trimmedTeamName.length === 0) {
                    throw new Error("Team name is required.");
                  }

                  setCreatingTeam(true);
                  try {
                    const createdTeam = await user.createTeam({
                      displayName: trimmedTeamName,
                    });
                    await user.setSelectedTeam(createdTeam.id);
                    setSelectedTeamId(createdTeam.id);
                    setNewTeamName("");
                    setIsCreateTeamOpen(false);
                  } finally {
                    setCreatingTeam(false);
                  }
                })}
              >
                Create Team
              </DesignButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-grow justify-center">
      <ProjectOnboardingWizard
        project={selectedProject}
        status={selectedProjectStatus ?? "config_choice"}
        mode={mode}
        setMode={(nextMode) => updateSearchParams({ mode: nextMode })}
        setStatus={(nextStatus) => setSelectedProjectStatus(selectedProject, nextStatus)}
        onComplete={() => {
          router.push(`/projects/${encodeURIComponent(selectedProject.id)}`);
        }}
      />
    </div>
  );
}
