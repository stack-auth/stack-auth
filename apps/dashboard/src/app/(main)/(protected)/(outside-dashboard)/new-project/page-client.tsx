'use client';

import { AppIcon } from "@/components/app-square";
import { StripeWordmark } from "@/components/stripe-wordmark";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignBadge } from "@/components/design-components/badge";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard, DesignPillToggle } from "@/components/design-components";
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
  ArrowsClockwiseIcon,
  ChartBarIcon,
  CheckCircleIcon,
  LinkBreakIcon,
  PlusCircleIcon,
  ShieldCheckIcon,
  SparkleIcon,
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
    methods.add("github");
  }

  return methods;
}

function deriveInitialApps(config: ReturnType<AdminOwnedProject["useConfig"]>, status: ProjectOnboardingStatus): Set<AppId> {
  const enabledApps = new Set<AppId>();

  for (const appId of ALL_APP_IDS) {
    if (config.apps.installed[appId]?.enabled) {
      enabledApps.add(appId);
    }
  }

  const isInEarlyOnboardingStep = (
    status === "config_choice"
    || status === "apps_selection"
    || status === "auth_setup"
  );

  if (enabledApps.size === 0 || (isInEarlyOnboardingStep && enabledApps.size <= REQUIRED_APP_IDS.length)) {
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

function OnboardingPage(props: {
  stepKey: string,
  title: string,
  subtitle?: string,
  steps: TimelineStep[],
  currentStep: ProjectOnboardingStatus,
  onStepClick?: (step: ProjectOnboardingStatus) => void,
  disabled?: boolean,
  primaryAction: React.ReactNode,
  secondaryAction?: React.ReactNode,
  wide?: boolean,
  actionsLayout?: "stacked" | "inline",
  children: React.ReactNode,
}) {
  const currentIndex = props.steps.findIndex((s) => s.id === props.currentStep);

  return (
    <div className="flex w-full flex-grow flex-col items-center justify-center px-4 pb-16 pt-8">
      <div
        key={props.stepKey}
        className={cn(
          "flex w-full flex-col items-center gap-8",
          props.wide ? "max-w-5xl" : "max-w-[560px]",
        )}
      >
        <div className="onboarding-cascade space-y-2 text-center" style={{ "--cascade-i": 0 } as React.CSSProperties}>
          <Typography className="text-3xl font-semibold tracking-tight">
            {props.title}
          </Typography>
          {props.subtitle != null && (
            <Typography variant="secondary" className="mx-auto max-w-md text-sm leading-relaxed">
              {props.subtitle}
            </Typography>
          )}
        </div>

        <div className="onboarding-cascade w-full" style={{ "--cascade-i": 1 } as React.CSSProperties}>
          {props.children}
        </div>

        <div className="onboarding-cascade" style={{ "--cascade-i": 2 } as React.CSSProperties}>
          {props.actionsLayout === "inline" ? (
            <div className="flex items-center gap-3">
              {props.primaryAction}
              {props.secondaryAction != null && props.secondaryAction}
            </div>
          ) : (
            <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
              {props.primaryAction}
              {props.secondaryAction != null && (
                <div className="flex justify-center">
                  {props.secondaryAction}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="onboarding-cascade fixed bottom-6 left-0 right-0 z-50 flex justify-center" style={{ "--cascade-i": 3 } as React.CSSProperties}>
        <div className="flex items-center gap-[5px]">
          {props.steps.map((step, index) => {
            const isComplete = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isClickable = isComplete && !props.disabled && props.onStepClick != null;
            return (
              <button
                key={step.id}
                type="button"
                disabled={!isClickable}
                onClick={() => { if (isClickable) props.onStepClick?.(step.id); }}
                className={cn(
                  "rounded-full transition-all duration-300",
                  isCurrent
                    ? "h-[6px] w-5 bg-foreground"
                    : isComplete
                      ? "h-[6px] w-[6px] cursor-pointer bg-foreground/40 hover:bg-foreground/60"
                      : "h-[6px] w-[6px] cursor-default bg-foreground/20",
                )}
                title={step.label}
              />
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes onboarding-cascade-in {
          0% {
            opacity: 0;
            transform: translateY(18px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .onboarding-cascade {
          opacity: 0;
          animation: onboarding-cascade-in 500ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
          animation-delay: calc(var(--cascade-i, 0) * 80ms + 60ms);
        }
        @media (prefers-reduced-motion: reduce) {
          .onboarding-cascade {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>
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

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={props.required ? undefined : props.onToggle}
          disabled={props.disabled}
          className={cn(
            "group flex flex-col items-center gap-1.5 rounded-xl p-1 transition-opacity duration-150 hover:transition-none",
            props.primary ? "w-[100px]" : "w-[90px]",
            props.required ? "cursor-default opacity-100" : props.selected ? "opacity-100" : "opacity-70 hover:opacity-100",
            props.disabled && "pointer-events-none opacity-40",
            !props.required && "active:scale-[0.97]",
          )}
        >
          <div className="relative">
            <AppIcon appId={props.appId} enabled={props.selected} className={props.primary ? "w-20 h-20" : "w-16 h-16"} />
            {props.selected && (
              <div className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                <CheckCircleIcon className="h-4 w-4" weight="fill" />
              </div>
            )}
          </div>
          <Typography className={cn(
            "text-center leading-tight",
            props.primary ? "text-sm font-semibold" : "text-[11px] font-medium",
          )}>
            {app.displayName}
          </Typography>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="z-50 max-w-[240px] rounded-xl border-0 bg-white p-3 shadow-lg ring-1 ring-black/[0.06] dark:bg-background dark:ring-white/[0.06]"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Typography className="text-sm font-semibold text-foreground">{app.displayName}</Typography>
            {props.required && (
              <DesignBadge label="Required" color="orange" size="sm" />
            )}
            {!props.required && stageBadgeColor != null && (
              <DesignBadge
                label={app.stage === "alpha" ? "Alpha" : "Beta"}
                color={stageBadgeColor}
                size="sm"
              />
            )}
          </div>
          <Typography className="text-xs leading-relaxed text-muted-foreground">
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
    <div className="mx-auto flex min-h-[260px] w-full max-w-2xl flex-col items-center justify-center gap-6 text-center">
      <DesignAlert
        variant="warning"
        title="Not available yet"
        description="Linking an existing config into onboarding is not available yet."
        glassmorphic
      />
      <div className="flex justify-center">
        <DesignButton variant="outline" className="rounded-full px-8" onClick={props.onBack}>
          Go Back
        </DesignButton>
      </div>
    </div>
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
  const [selectedApps, setSelectedApps] = useState<Set<AppId>>(() => deriveInitialApps(completeConfig, status));
  const [signInMethods, setSignInMethods] = useState<Set<SignInMethod>>(() => deriveInitialSignInMethods(project, status));
  const [trustedDomain, setTrustedDomain] = useState("");
  const [domainHandlerPath, setDomainHandlerPath] = useState("/handler");
  const [managedSubdomain, setManagedSubdomain] = useState("");
  const [managedSenderLocalPart, setManagedSenderLocalPart] = useState("");
  const [managedDomainSetupStatus, setManagedDomainSetupStatus] = useState<string | null>(null);
  const [selectedEmailThemeId, setSelectedEmailThemeId] = useState(completeConfig.emails.selectedThemeId);
  const [selectedPaymentsCountry, setSelectedPaymentsCountry] = useState("US");
  const [selectedConfigChoice, setSelectedConfigChoice] = useState<"create-new" | "link-existing">("create-new");
  const [authSetupMobileTab, setAuthSetupMobileTab] = useState<"methods" | "preview">("methods");
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

    setSelectedApps(deriveInitialApps(completeConfig, status));
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
    setSelectedConfigChoice("create-new");
    setAuthSetupMobileTab("methods");
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
        next.add(appId);
        return next;
      }

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
      <OnboardingPage
        stepKey="config-choice-link-existing"
        title="Link an existing config"
        subtitle="This option is coming soon."
        steps={timelineSteps}
        currentStep="config_choice"
        onStepClick={handleTimelineStepClick}
        disabled={saving}
        primaryAction={
          <DesignButton
            variant="outline"
            className="w-full rounded-full"
            onClick={() => {
              props.setMode(null);
              setSelectedConfigChoice("create-new");
            }}
          >
            Go Back
          </DesignButton>
        }
      >
        <ModeNotImplementedCard
          onBack={() => {
            props.setMode(null);
            setSelectedConfigChoice("create-new");
          }}
        />
      </OnboardingPage>
    );
  }

  if (props.status === "config_choice") {
    const createNewSelected = selectedConfigChoice === "create-new";
    const linkExistingSelected = selectedConfigChoice === "link-existing";

    return (
      <OnboardingPage
        stepKey="config-choice"
        title="Choose how you want to start"
        subtitle="Start fresh or link an existing config."
        steps={timelineSteps}
        currentStep="config_choice"
        onStepClick={handleTimelineStepClick}
        disabled={saving}
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
            loading={saving}
            onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
              if (selectedConfigChoice === "create-new") {
                await props.setStatus("apps_selection");
              } else {
                props.setMode("link-existing");
              }
            }))}
          >
            Continue
          </DesignButton>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => setSelectedConfigChoice("create-new")}
            className={cn(
              "relative flex flex-col items-center gap-6 rounded-2xl p-10 text-center transition-[box-shadow,background-color] duration-150 hover:transition-none",
              createNewSelected
                ? "bg-white ring-2 ring-blue-500/50 shadow-md dark:bg-blue-500/[0.08] dark:ring-blue-500/50 dark:shadow-none"
                : "bg-white/50 ring-1 ring-black/[0.06] hover:ring-black/[0.10] dark:bg-background/60 dark:backdrop-blur-xl dark:ring-white/[0.06] dark:hover:ring-white/[0.10]",
            )}
          >
            {createNewSelected && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
                <CheckCircleIcon className="h-4 w-4" weight="fill" />
              </div>
            )}
            <div className={cn(
              "rounded-xl p-4",
              createNewSelected ? "bg-blue-500/15 text-blue-500" : "bg-foreground/[0.06] text-muted-foreground",
            )}>
              <SparkleIcon className="h-7 w-7" />
            </div>
            <div className="space-y-1.5">
              <Typography className="text-base font-semibold">Create New</Typography>
              <Typography variant="secondary" className="text-sm leading-relaxed">Start from curated defaults.</Typography>
            </div>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => setSelectedConfigChoice("link-existing")}
            className={cn(
              "relative flex flex-col items-center gap-6 rounded-2xl p-10 text-center transition-[box-shadow,background-color] duration-150 hover:transition-none",
              linkExistingSelected
                ? "bg-white ring-2 ring-blue-500/50 shadow-md dark:bg-blue-500/[0.08] dark:ring-blue-500/50 dark:shadow-none"
                : "bg-white/50 ring-1 ring-black/[0.06] hover:ring-black/[0.10] dark:bg-background/60 dark:backdrop-blur-xl dark:ring-white/[0.06] dark:hover:ring-white/[0.10]",
            )}
          >
            {linkExistingSelected && (
              <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
                <CheckCircleIcon className="h-4 w-4" weight="fill" />
              </div>
            )}
            <div className={cn(
              "rounded-xl p-4",
              linkExistingSelected ? "bg-blue-500/15 text-blue-500" : "bg-foreground/[0.06] text-muted-foreground",
            )}>
              <LinkBreakIcon className="h-7 w-7" />
            </div>
            <div className="space-y-1.5">
              <Typography className="text-base font-semibold">Link Existing Config</Typography>
              <Typography variant="secondary" className="text-sm leading-relaxed">Bring an existing config into this project.</Typography>
            </div>
          </button>
        </div>
      </OnboardingPage>
    );
  }

  if (props.status === "apps_selection") {
    const orderedIds = orderedAppIds();
    const primaryAppIds = orderedIds.filter((appId) => PRIMARY_APP_IDS.includes(appId));
    const secondaryAppIds = orderedIds.filter((appId) => !PRIMARY_APP_IDS.includes(appId));
    const moreAppsSplitIndex = secondaryAppIds.length >= 10 ? Math.floor(secondaryAppIds.length / 2) : secondaryAppIds.length;
    const moreAppsFirstRow = secondaryAppIds.slice(0, moreAppsSplitIndex);
    const moreAppsSecondRow = secondaryAppIds.slice(moreAppsSplitIndex);

    return (
      <OnboardingPage
        stepKey="apps-selection"
        title="Select apps"
        subtitle="Choose the apps to include in this project."
        steps={timelineSteps}
        currentStep="apps_selection"
        onStepClick={handleTimelineStepClick}
        disabled={saving}
        wide
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
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
            Continue
          </DesignButton>
        }
      >
        <TooltipProvider delayDuration={0}>
          <div className="space-y-6">
            <div className="space-y-3">
              <Typography className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Core apps
              </Typography>
              <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-2">
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

            <div className="space-y-3">
              <Typography className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                More apps
              </Typography>
              {secondaryAppIds.length >= 10 ? (
                <div className="flex flex-col items-stretch gap-y-3">
                  <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-1">
                    {moreAppsFirstRow.map((appId) => (
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
                  <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-1">
                    {moreAppsSecondRow.map((appId) => (
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
              ) : (
                <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-1">
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
              )}
            </div>
          </div>
        </TooltipProvider>
      </OnboardingPage>
    );
  }

  if (props.status === "auth_setup") {
    return (
      <OnboardingPage
        stepKey="auth-setup"
        title="Configure authentication"
        subtitle="Choose which sign-in methods to enable."
        steps={timelineSteps}
        currentStep="auth_setup"
        onStepClick={handleTimelineStepClick}
        disabled={saving}
        wide
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
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
            Continue
          </DesignButton>
        }
      >
        <DesignCard
          glassmorphic={false}
          contentClassName="p-0 overflow-hidden"
          className="border-0 bg-white/90 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.10]"
        >
          <div className="flex justify-center border-b border-black/[0.12] px-4 py-3 dark:border-white/[0.06] md:hidden">
            <DesignPillToggle
              options={[
                { id: "methods", label: "Sign-in methods" },
                { id: "preview", label: "Preview" },
              ]}
              selected={authSetupMobileTab}
              onSelect={(id) => { setAuthSetupMobileTab(id === "preview" ? "preview" : "methods"); }}
              size="sm"
              gradient="default"
              className="flex w-full max-w-md justify-center"
            />
          </div>
          <div className="grid md:grid-cols-[minmax(260px,2fr)_minmax(0,3fr)]">
            <div
              className={cn(
                "flex flex-col justify-center border-b border-black/[0.12] dark:border-white/[0.06] md:border-b-0 md:border-r",
                authSetupMobileTab !== "methods" && "max-md:hidden",
              )}
            >
              <div className="p-4 md:p-6">
                <Typography className="mb-3 text-sm font-medium text-muted-foreground md:mb-4">
                  Sign-in methods
                </Typography>
                <div className="overflow-hidden rounded-xl bg-white/90 ring-1 ring-black/[0.06] dark:bg-foreground/[0.04] dark:ring-white/[0.06]">
                  {SIGN_IN_METHODS.map((method, index) => {
                    const checked = signInMethods.has(method.id);
                    return (
                      <label
                        key={method.id}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 md:gap-4 md:px-4 md:py-3",
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

            <div
              className={cn(
                "flex items-center justify-center bg-foreground/[0.02] px-3 py-3 md:px-4 md:py-4 lg:px-6",
                authSetupMobileTab !== "preview" && "max-md:hidden",
              )}
            >
              <BrowserFrame url="your-website.com/signin" className="w-full">
                <div className="flex min-h-[180px] items-center justify-center px-4 py-3 sm:min-h-[220px] md:min-h-[260px] md:px-5 md:py-4 lg:min-h-[300px]">
                  <div className="pointer-events-none relative flex w-full items-center justify-center" inert>
                    <div className="absolute inset-0 z-10 bg-transparent" />
                    <div className="auth-preview-host-theme flex w-full justify-center">
                      <AuthPage type="sign-in" mockProject={authPreviewProject} />
                    </div>
                  </div>
                </div>
              </BrowserFrame>
            </div>
          </div>
        </DesignCard>
      </OnboardingPage>
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
      <OnboardingPage
        stepKey="email-theme-setup"
        title="Select an email theme"
        subtitle="Pick a theme for your transactional emails, or keep the default."
        steps={timelineSteps}
        currentStep="email_theme_setup"
        onStepClick={handleTimelineStepClick}
        disabled={saving}
        wide
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
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
            {includePayments ? "Continue" : "Finish"}
          </DesignButton>
        }
      >
        <div className="space-y-4">
          {emailThemes.length === 0 && (
            <DesignAlert
              variant="warning"
              title="No themes found"
              description="Theme selection is temporarily unavailable. You can still continue."
              glassmorphic
            />
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {emailThemes.map((theme) => {
              const isSelected = selectedEmailThemeId === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setSelectedEmailThemeId(theme.id)}
                  className={cn(
                    "relative flex flex-col overflow-hidden rounded-2xl text-left transition-[box-shadow,background-color] duration-150 hover:transition-none",
                    isSelected
                      ? cn(
                          "bg-blue-500/[0.06] dark:bg-blue-500/[0.04] ring-1 ring-blue-500/40",
                          "shadow-[0_12px_40px_-8px_rgba(59,130,246,0.45),0_0_1px_rgba(59,130,246,0.2)]",
                          "dark:shadow-[0_14px_48px_-10px_rgba(96,165,250,0.38),0_0_1px_rgba(96,165,250,0.25)]",
                        )
                      : cn(
                          "bg-white/60 dark:bg-background/40 dark:backdrop-blur-xl",
                          "ring-1 ring-black/[0.05] hover:ring-black/[0.09] dark:ring-white/[0.05] dark:hover:ring-white/[0.09]",
                        ),
                  )}
                >
                  <div
                    className={cn(
                      "aspect-[4/3] overflow-hidden border-b border-black/[0.06] dark:border-white/[0.06] bg-background transition-opacity duration-150",
                      !isSelected && "opacity-[0.65]",
                    )}
                  >
                    <div style={{ transform: "scale(0.5)", transformOrigin: "top left", width: "200%", height: "200%" }}>
                      <OnboardingEmailThemePreview adminApp={props.project.app} themeId={theme.id} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 p-3">
                    <Typography
                      className={cn(
                        "min-w-0 flex-1 text-sm font-medium transition-colors duration-150",
                        isSelected ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {theme.displayName}
                    </Typography>
                    {isSelected && (
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                        <CheckCircleIcon className="h-4 w-4" weight="fill" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </OnboardingPage>
    );
  }

  if (props.status === "payments_setup") {
    return (
      <OnboardingPage
        stepKey="payments-setup"
        title="Set up payments"
        subtitle="Connect Stripe to start accepting payments from your users."
        steps={timelineSteps}
        currentStep="payments_setup"
        onStepClick={handleTimelineStepClick}
        disabled={saving}
        actionsLayout="inline"
        primaryAction={
          <DesignButton
            className="rounded-full px-6"
            loading={saving}
            onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
              await finalizeOnboarding();
            }))}
          >
            Do Later
          </DesignButton>
        }
        secondaryAction={selectedPaymentsCountry === "US" ? (
          <DesignButton
            className="rounded-full px-6"
            variant="outline"
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
            Connect Stripe
          </DesignButton>
        ) : undefined}
      >
        <div className="mx-auto w-full max-w-sm">
          <DesignCard
            glassmorphic={false}
            className="border-0 bg-white/90 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.10]"
            contentClassName="!p-6 md:!p-7"
          >
            <div className="flex flex-col items-center gap-6 md:gap-7">
              <Typography type="h2" className="text-center tracking-tight text-balance">
                Built-in Billing
              </Typography>

              <div className="flex w-full flex-col gap-3 rounded-xl bg-foreground/[0.03] px-5 py-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2.5">
                  <WebhooksLogoIcon className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
                  <span>No webhooks or syncing required</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <ArrowsClockwiseIcon className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
                  <span>One-time and recurring payments</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <ChartBarIcon className="h-3.5 w-3.5 shrink-0 text-foreground/50" />
                  <span>Usage-based billing support</span>
                </div>
              </div>

              <div className="w-full space-y-2.5">
                <Typography className="text-xs font-medium text-muted-foreground">Country of residence</Typography>
                <DesignSelectorDropdown
                  value={selectedPaymentsCountry}
                  onValueChange={setSelectedPaymentsCountry}
                  options={PAYMENT_COUNTRY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
                  size="md"
                />
                <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-xs text-muted-foreground">
                  <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>Powered by</span>
                  <StripeWordmark className="h-3 w-auto shrink-0 translate-y-px text-[#635BFF] dark:text-[#8b87ff]" />
                </div>
                {selectedPaymentsCountry !== "US" && (
                  <Typography className="text-center text-xs text-amber-600 dark:text-amber-400">
                    Payments is currently only available in the United States.
                  </Typography>
                )}
              </div>
            </div>
          </DesignCard>
        </div>
      </OnboardingPage>
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
