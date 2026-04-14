"use client";

import { DesignCard, DesignPillToggle } from "@/components/design-components";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignButton } from "@/components/design-components/button";
import { DesignSelectorDropdown } from "@/components/design-components/select";
import { useRouter } from "@/components/router";
import { StripeWordmark } from "@/components/stripe-wordmark";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  BrowserFrame,
  Button,
  cn,
  Switch,
  TooltipProvider,
  Typography,
} from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import {
  ArrowsClockwiseIcon,
  ChartBarIcon,
  CheckCircleIcon,
  LinkBreakIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
  WebhooksLogoIcon,
} from "@phosphor-icons/react";
import { AdminOwnedProject, AuthPage } from "@stackframe/stack";
import { type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { projectOnboardingStatusValues, type ProjectOnboardingStatus } from "@stackframe/stack-shared/dist/schema-fields";
import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DomainSetupTransitionState,
  ModeNotImplementedCard,
  OnboardingAppCard,
  OnboardingEmailThemePreview,
  OnboardingPage,
} from "./components";
import {
  ALL_APP_IDS,
  buildTimeline,
  deriveInitialApps,
  deriveInitialSignInMethods,
  getStepIndex,
  orderedAppIds,
  PAYMENT_COUNTRY_OPTIONS,
  PRIMARY_APP_IDS,
  REQUIRED_APP_IDS,
  SIGN_IN_METHODS,
  type SignInMethod,
} from "./shared";

const PROJECT_ONBOARDING_STATUSES = projectOnboardingStatusValues;

export function ProjectOnboardingWizard(props: {
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
  const [domainSetupAutoAdvanceError, setDomainSetupAutoAdvanceError] = useState<string | null>(null);
  const [domainSetupAutoAdvancing, setDomainSetupAutoAdvancing] = useState(false);
  const previousProjectId = useRef<string | null>(null);
  const paymentsAutoCompletingRef = useRef(false);
  const stripeAccountInfo = props.project.app.useStripeAccountInfo();

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
    setDomainSetupAutoAdvanceError(null);
    setDomainSetupAutoAdvancing(false);
    paymentsAutoCompletingRef.current = false;
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

  const advanceFromDomainSetup = useCallback(() => {
    return runAsynchronouslyWithAlert(async () => {
      setDomainSetupAutoAdvanceError(null);
      setDomainSetupAutoAdvancing(true);
      try {
        await setStatus("email_theme_setup");
      } catch (error) {
        setDomainSetupAutoAdvanceError(error instanceof Error ? error.message : "Failed to continue to the email theme step.");
        throw error;
      } finally {
        setDomainSetupAutoAdvancing(false);
      }
    });
  }, [setStatus]);

  useEffect(() => {
    if (status !== "domain_setup") {
      return;
    }

    advanceFromDomainSetup();
  }, [advanceFromDomainSetup, status]);

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

  useEffect(() => {
    if (status !== "payments_setup" || stripeAccountInfo?.details_submitted !== true || paymentsAutoCompletingRef.current) {
      return;
    }

    paymentsAutoCompletingRef.current = true;
    runAsynchronouslyWithAlert(async () => {
      try {
        await finalizeOnboarding();
      } catch (error) {
        paymentsAutoCompletingRef.current = false;
        throw error;
      }
    });
  }, [finalizeOnboarding, status, stripeAccountInfo?.details_submitted]);

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
      <DomainSetupTransitionState
        advancing={domainSetupAutoAdvancing}
        errorMessage={domainSetupAutoAdvanceError}
        onRetry={advanceFromDomainSetup}
        onOpenProject={() => router.push(`/projects/${encodeURIComponent(project.id)}`)}
      />
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
        subtitle="Connect bank account to start accepting payments from your users."
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
            Connect
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
                  options={PAYMENT_COUNTRY_OPTIONS.map((country) => ({ value: country.value, label: country.label }))}
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
