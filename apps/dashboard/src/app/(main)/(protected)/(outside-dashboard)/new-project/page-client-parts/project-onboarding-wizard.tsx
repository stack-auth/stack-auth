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
  Skeleton,
  cn,
  Switch,
  TooltipProvider,
  Typography,
} from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
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
import { AuthPage, type AdminOwnedProject } from "@hexclave/next";
import { type AppId } from "@hexclave/shared/dist/apps/apps-config";
import { type EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DomainSetupTransitionState,
  OnboardingAppCard,
  OnboardingEmailThemePreview,
  OnboardingPage,
  WelcomeSlide,
} from "./components";
import {
  ALL_APP_IDS,
  buildLinkExistingTimeline,
  buildTimeline,
  deriveInitialApps,
  deriveInitialSignInMethods,
  getStepIndex,
  normalizeProjectOnboardingState,
  createProjectOnboardingState,
  OAUTH_SIGN_IN_METHODS,
  type OnboardingConfigChoice,
  type OnboardingPaymentsCountry,
  type OnboardingProgressUpdate,
  orderedAppIds,
  PAYMENT_COUNTRY_OPTIONS,
  PRIMARY_APP_IDS,
  type ProjectOnboardingState,
  type ProjectOnboardingStatus,
  REQUIRED_APP_IDS,
  SHARED_OAUTH_SIGN_IN_METHODS,
  SIGN_IN_METHODS,
  type SignInMethod,
} from "./shared";
import { LinkExistingOnboarding } from "./link-existing-onboarding";

export function ProjectOnboardingWizard(props: {
  project: AdminOwnedProject,
  status: ProjectOnboardingStatus,
  onboardingState: ProjectOnboardingState | null,
  mode: string | null,
  setMode: (mode: string | null) => void,
  saveOnboardingProgress: (update: OnboardingProgressUpdate) => Promise<void>,
  onComplete: () => void,
}) {
  const router = useRouter();
  const { project, status, onboardingState, setMode, saveOnboardingProgress, onComplete } = props;
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  const isDevelopmentEnvironment = isLocalEmulator || isRemoteDevelopmentEnvironment;
  const completeConfig = project.useConfig();
  const updateConfig = useUpdateConfig();
  const finishProjectOnboarding = onComplete;
  const deriveCurrentOnboardingState = useCallback((onboardingStatus: ProjectOnboardingStatus): ProjectOnboardingState => {
    const defaultState = createProjectOnboardingState({
      selectedConfigChoice: "create-new",
      selectedApps: deriveInitialApps(completeConfig, onboardingStatus),
      selectedSignInMethods: deriveInitialSignInMethods(project, onboardingStatus),
      selectedEmailThemeId: completeConfig.emails.selectedThemeId,
      selectedPaymentsCountry: "US",
      developmentEnvironment: isDevelopmentEnvironment,
      isLocalEmulator,
    });
    if (onboardingState == null) {
      return defaultState;
    }
    return normalizeProjectOnboardingState(onboardingState, { developmentEnvironment: isDevelopmentEnvironment, isLocalEmulator });
  }, [completeConfig, isDevelopmentEnvironment, isLocalEmulator, onboardingState, project]);
  const initialOnboardingState = deriveCurrentOnboardingState(status);
  const [saving, setSaving] = useState(false);
  const [selectedApps, setSelectedApps] = useState<Set<AppId>>(() => new Set(initialOnboardingState.selected_apps));
  const [signInMethods, setSignInMethods] = useState<Set<SignInMethod>>(() => new Set(initialOnboardingState.selected_sign_in_methods));
  const [trustedDomain, setTrustedDomain] = useState("");
  const [domainHandlerPath, setDomainHandlerPath] = useState("/handler");
  const [managedSubdomain, setManagedSubdomain] = useState("");
  const [managedSenderLocalPart, setManagedSenderLocalPart] = useState("");
  const [managedDomainSetupStatus, setManagedDomainSetupStatus] = useState<string | null>(null);
  const [selectedEmailThemeId, setSelectedEmailThemeId] = useState<string | null>(initialOnboardingState.selected_email_theme_id);
  const [selectedPaymentsCountry, setSelectedPaymentsCountry] = useState<OnboardingPaymentsCountry>(initialOnboardingState.selected_payments_country);
  const [selectedConfigChoice, setSelectedConfigChoice] = useState<OnboardingConfigChoice>(initialOnboardingState.selected_config_choice);
  const [authSetupMobileTab, setAuthSetupMobileTab] = useState<"methods" | "preview">("methods");
  const [domainSetupAutoAdvanceError, setDomainSetupAutoAdvanceError] = useState<string | null>(null);
  const [domainSetupAutoAdvancing, setDomainSetupAutoAdvancing] = useState(false);
  const [paymentsSetupAction, setPaymentsSetupAction] = useState<"defer" | "connect" | null>(null);
  const previousProjectId = useRef<string | null>(null);
  const finalConfigSavePromiseRef = useRef<Promise<boolean> | null>(null);

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

    const onboardingState = deriveCurrentOnboardingState(status);
    setSelectedApps(new Set(onboardingState.selected_apps));
    setSignInMethods(new Set(onboardingState.selected_sign_in_methods));

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
    setSelectedEmailThemeId(onboardingState.selected_email_theme_id);
    setManagedDomainSetupStatus(null);
    setSelectedConfigChoice(onboardingState.selected_config_choice);
    setSelectedPaymentsCountry(onboardingState.selected_payments_country);
    setAuthSetupMobileTab("methods");
    setDomainSetupAutoAdvanceError(null);
    setDomainSetupAutoAdvancing(false);
    setPaymentsSetupAction(null);
    finalConfigSavePromiseRef.current = null;
  }, [completeConfig, deriveCurrentOnboardingState, project, project.id, status]);

  const isLinkExistingMode = !isDevelopmentEnvironment && props.mode === "link-existing";
  const paymentsAppEnabledInConfig = completeConfig.apps.installed.payments?.enabled === true;
  const includePayments = (
    status === "payments_setup"
    || paymentsAppEnabledInConfig
    || (!isLinkExistingMode && selectedApps.has("payments"))
  );
  const timelineSteps = useMemo(
    () => isLinkExistingMode ? buildLinkExistingTimeline(includePayments) : buildTimeline(includePayments),
    [includePayments, isLinkExistingMode],
  );
  const currentTimelineIndex = useMemo(() => getStepIndex(timelineSteps, status), [status, timelineSteps]);

  useEffect(() => {
    if (isLinkExistingMode || (status !== "apps_selection" && status !== "auth_setup")) {
      return;
    }

    runAsynchronously(async () => {
      await project.app.listEmailThemes();
    }, { noErrorLogging: true });
  }, [isLinkExistingMode, project.app, status]);

  useEffect(() => {
    if (status !== "email_theme_setup" || !includePayments) {
      return;
    }

    runAsynchronously(async () => {
      await project.app.getStripeAccountInfo();
    }, { noErrorLogging: true });
  }, [includePayments, project.app, status]);

  const handleTimelineStepClick = useCallback((step: ProjectOnboardingStatus) => {
    const targetIndex = getStepIndex(timelineSteps, step);
    if (targetIndex < 0 || targetIndex >= currentTimelineIndex) {
      return;
    }

    runAsynchronouslyWithAlert(async () => {
      if (step === "config_choice" && props.mode !== "link-existing") {
        setMode(null);
      }
      await saveOnboardingProgress({ status: step });
    });
  }, [currentTimelineIndex, props.mode, saveOnboardingProgress, setMode, timelineSteps]);

  const handleBack = useMemo(() => {
    if (currentTimelineIndex <= 0) {
      return undefined;
    }
    const previousStep = timelineSteps[currentTimelineIndex - 1].id;
    return () => handleTimelineStepClick(previousStep);
  }, [currentTimelineIndex, handleTimelineStepClick, timelineSteps]);

  const advanceFromDomainSetup = useCallback(() => {
    return runAsynchronouslyWithAlert(async () => {
      setDomainSetupAutoAdvanceError(null);
      setDomainSetupAutoAdvancing(true);
      try {
        await saveOnboardingProgress({ status: "email_theme_setup" });
      } catch (error) {
        setDomainSetupAutoAdvanceError(error instanceof Error ? error.message : "Failed to continue to the email theme step.");
        throw error;
      } finally {
        setDomainSetupAutoAdvancing(false);
      }
    });
  }, [saveOnboardingProgress]);

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
        oauthProviders: SHARED_OAUTH_SIGN_IN_METHODS
          .filter((providerId) => signInMethods.has(providerId))
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

  const buildOnboardingState = useCallback((): ProjectOnboardingState => {
    return createProjectOnboardingState({
      selectedConfigChoice,
      selectedApps,
      selectedSignInMethods: signInMethods,
      selectedEmailThemeId: selectedEmailThemeId ?? completeConfig.emails.selectedThemeId,
      selectedPaymentsCountry,
      developmentEnvironment: isDevelopmentEnvironment,
      isLocalEmulator,
    });
  }, [completeConfig.emails.selectedThemeId, isDevelopmentEnvironment, isLocalEmulator, selectedApps, selectedConfigChoice, selectedEmailThemeId, selectedPaymentsCountry, signInMethods]);

  const saveCurrentOnboardingProgress = useCallback(async (nextStatus: ProjectOnboardingStatus) => {
    await saveOnboardingProgress({
      status: nextStatus,
      onboardingState: buildOnboardingState(),
    });
  }, [buildOnboardingState, saveOnboardingProgress]);

  const buildBranchConfigUpdate = useCallback(() => {
    const emailThemeId = selectedEmailThemeId ?? completeConfig.emails.selectedThemeId;
    const configUpdate: EnvironmentConfigOverrideOverride = {
      "auth.password.allowSignIn": signInMethods.has("credential"),
      "auth.otp.allowSignIn": signInMethods.has("magicLink"),
      "auth.passkey.allowSignIn": signInMethods.has("passkey"),
      "emails.selectedThemeId": emailThemeId,
    };
    for (const appId of ALL_APP_IDS) {
      configUpdate[`apps.installed.${appId}.enabled`] = selectedApps.has(appId);
    }
    if (isLocalEmulator) {
      configUpdate["auth.oauth.providers.google"] = signInMethods.has("google") ? {
        type: "google",
        allowSignIn: true,
        allowConnectedAccounts: true,
      } : null;
      configUpdate["auth.oauth.providers.github"] = signInMethods.has("github") ? {
        type: "github",
        allowSignIn: true,
        allowConnectedAccounts: true,
      } : null;
      configUpdate["auth.oauth.providers.microsoft"] = signInMethods.has("microsoft") ? {
        type: "microsoft",
        allowSignIn: true,
        allowConnectedAccounts: true,
      } : null;
    }
    return configUpdate;
  }, [completeConfig.emails.selectedThemeId, isLocalEmulator, selectedApps, selectedEmailThemeId, signInMethods]);

  const buildEnvironmentOAuthConfigUpdate = useCallback(() => {
    const configUpdate: EnvironmentConfigOverrideOverride = {};
    for (const providerId of SHARED_OAUTH_SIGN_IN_METHODS) {
      configUpdate[`auth.oauth.providers.${providerId}`] = signInMethods.has(providerId) ? {
        type: providerId,
        isShared: true,
        allowSignIn: true,
        allowConnectedAccounts: true,
      } : null;
    }
    return configUpdate;
  }, [signInMethods]);

  const saveFinalConfig = useCallback(async (): Promise<boolean> => {
    if (isLinkExistingMode) {
      return true;
    }

    const branchConfigUpdated = await updateConfig({
      adminApp: props.project.app,
      configUpdate: buildBranchConfigUpdate(),
      pushable: true,
    });
    if (!branchConfigUpdated) {
      return false;
    }

    if (!isLocalEmulator) {
      const providersUpdated = await updateConfig({
        adminApp: props.project.app,
        configUpdate: buildEnvironmentOAuthConfigUpdate(),
        pushable: false,
      });
      if (!providersUpdated) {
        return false;
      }
    }

    return true;
  }, [
    buildBranchConfigUpdate,
    buildEnvironmentOAuthConfigUpdate,
    isLinkExistingMode,
    isLocalEmulator,
    props.project.app,
    updateConfig,
  ]);

  useEffect(() => {
    if (status !== "welcome" || isLinkExistingMode || isLocalEmulator || finalConfigSavePromiseRef.current != null) {
      return;
    }

    finalConfigSavePromiseRef.current = (async () => {
      const pushedConfigSource = await props.project.getPushedConfigSource();
      if (pushedConfigSource.type !== "unlinked") {
        return false;
      }
      return await saveFinalConfig();
    })();
    runAsynchronously(finalConfigSavePromiseRef.current, { noErrorLogging: true });
  }, [isLinkExistingMode, isLocalEmulator, props.project, saveFinalConfig, status]);

  const finalizeOnboarding = useCallback(async () => {
    await runWithSaving(async () => {
      const backgroundConfigSave = finalConfigSavePromiseRef.current;
      let configSaved: boolean;
      try {
        configSaved = backgroundConfigSave != null
          ? await backgroundConfigSave
          : await saveFinalConfig();
      } catch {
        finalConfigSavePromiseRef.current = null;
        configSaved = false;
      }

      if (!configSaved) {
        finalConfigSavePromiseRef.current = null;
        configSaved = await saveFinalConfig();
      }

      if (!configSaved) {
        throw new Error("Failed to save project configuration. Please try again.");
      }

      await saveOnboardingProgress({ status: "completed", onboardingState: null });
      finishProjectOnboarding();
    });
  }, [
    finishProjectOnboarding,
    runWithSaving,
    saveFinalConfig,
    saveOnboardingProgress,
  ]);

  const deferPaymentsSetup = useCallback(async () => {
    await runWithSaving(async () => {
      setPaymentsSetupAction("defer");
      try {
        if (selectedPaymentsCountry === "US") {
          await props.project.app.setupPayments();
        }
        await saveCurrentOnboardingProgress("welcome");
      } finally {
        setPaymentsSetupAction(null);
      }
    });
  }, [props.project.app, runWithSaving, saveCurrentOnboardingProgress, selectedPaymentsCountry]);

  const connectPaymentsSetup = useCallback(async () => {
    await runWithSaving(async () => {
      setPaymentsSetupAction("connect");
      try {
        const setup = await props.project.app.setupPayments();
        const redirectUrl = new URL(setup.url);
        if (redirectUrl.protocol !== "https:") {
          throw new Error("Payments setup redirect URL must use HTTPS.");
        }
        window.location.href = redirectUrl.toString();
      } finally {
        setPaymentsSetupAction(null);
      }
    });
  }, [props.project.app, runWithSaving]);

  if (props.status === "welcome") {
    return (
      <WelcomeSlide
        steps={timelineSteps}
        saving={saving}
        enabledApps={completeConfig.apps.installed}
        onFinish={() => runAsynchronouslyWithAlert(finalizeOnboarding)}
      />
    );
  }

  if (props.status === "config_choice" && props.mode === "link-existing" && !isDevelopmentEnvironment) {
    return (
      <LinkExistingOnboarding
        project={props.project}
        steps={timelineSteps}
        disabled={saving}
        currentStep="config_choice"
        onStepClick={handleTimelineStepClick}
        onBack={() => {
          props.setMode(null);
          setSelectedConfigChoice("create-new");
        }}
        onContinueAfterLink={async () => {
          const latestConfig = await props.project.getConfig();
          const paymentsEnabledInLatestConfig = latestConfig.apps.installed.payments?.enabled === true;
          if (paymentsEnabledInLatestConfig) {
            await saveOnboardingProgress({ status: "payments_setup" });
          } else {
            await saveOnboardingProgress({ status: "welcome" });
          }
        }}
      />
    );
  }

  if (props.status === "config_choice") {
    if (isDevelopmentEnvironment) {
      return (
        <OnboardingPage
          stepKey="config-choice"
          title="Welcome to Hexclave!"
          subtitle={`You are running Hexclave with the local dashboard.`}
          steps={timelineSteps}
          currentStep="config_choice"
          onStepClick={handleTimelineStepClick}
          disabled={saving}
          primaryAction={
            <DesignButton
              className="w-full rounded-full"
              loading={saving}
              onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
                await saveCurrentOnboardingProgress("apps_selection");
              }))}
            >
              Continue
            </DesignButton>
          }
        >
          <div className="mx-auto max-w-xl rounded-2xl bg-white/70 p-6 text-center ring-1 ring-black/[0.06] dark:bg-background/60 dark:ring-white/[0.06]">
            <Typography className="text-base leading-relaxed">
              This local project is running locally and ready to get started.
            </Typography>
            <Typography variant="secondary" className="mt-3 text-sm leading-relaxed">
              Next, we will guide you through the onboarding flow to set up your hexclave.config.ts file.
            </Typography>
          </div>
        </OnboardingPage>
      );
    }

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
        onBack={handleBack}
        disabled={saving}
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
            loading={saving}
            onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
              if (selectedConfigChoice === "create-new") {
                await saveCurrentOnboardingProgress("apps_selection");
              } else {
                await saveOnboardingProgress({ onboardingState: buildOnboardingState() });
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
                : "bg-white/90 ring-1 ring-black/[0.06] hover:ring-black/[0.10] dark:bg-white/[0.06] dark:ring-white/[0.10] dark:hover:ring-white/[0.14]",
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
              <Typography variant="secondary" className="text-sm leading-relaxed">Create and customize a new Hexclave project.</Typography>
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
                : "bg-white/90 ring-1 ring-black/[0.06] hover:ring-black/[0.10] dark:bg-white/[0.06] dark:ring-white/[0.10] dark:hover:ring-white/[0.14]",
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
              <Typography variant="secondary" className="text-sm leading-relaxed">If you already have a Hexclave project locally or on GitHub, link it here.</Typography>
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
        onBack={handleBack}
        disabled={saving}
        wide
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
            loading={saving}
            onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
              await saveCurrentOnboardingProgress("auth_setup");
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
    const availableSignInMethods = isLocalEmulator
      ? SIGN_IN_METHODS.filter((method) => !OAUTH_SIGN_IN_METHODS.some((oauthMethod) => oauthMethod === method.id))
      : SIGN_IN_METHODS;

    return (
      <OnboardingPage
        stepKey="auth-setup"
        title="Configure authentication"
        subtitle="Choose which sign-in methods to enable."
        steps={timelineSteps}
        currentStep="auth_setup"
        onStepClick={handleTimelineStepClick}
        onBack={handleBack}
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
              await saveCurrentOnboardingProgress("email_theme_setup");
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
                  {availableSignInMethods.map((method, index) => {
                    const checked = signInMethods.has(method.id);
                    return (
                      <label
                        key={method.id}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 md:gap-4 md:px-4 md:py-3",
                          index !== availableSignInMethods.length - 1 && "border-b border-black/[0.06] dark:border-white/[0.06]",
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
        onBack={handleBack}
        disabled={saving}
        wide
        primaryAction={
          <DesignButton
            className="w-full rounded-full"
            loading={saving}
            onClick={() => runAsynchronouslyWithAlert(() => runWithSaving(async () => {
              if (includePayments) {
                await saveCurrentOnboardingProgress("payments_setup");
              } else {
                await saveCurrentOnboardingProgress("welcome");
              }
            }))}
          >
            {includePayments ? "Continue" : "Finish"}
          </DesignButton>
        }
      >
        <Suspense fallback={<EmailThemeSetupStepSkeleton />}>
          <EmailThemeSetupStep
            project={props.project}
            saving={saving}
            selectedEmailThemeId={selectedEmailThemeId}
            setSelectedEmailThemeId={setSelectedEmailThemeId}
          />
        </Suspense>
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
        onBack={handleBack}
        disabled={saving}
        actionsLayout="inline"
        primaryAction={
          <DesignButton
            className="rounded-full px-6"
            disabled={saving || paymentsSetupAction != null}
            loading={paymentsSetupAction === "defer"}
            onClick={() => runAsynchronouslyWithAlert(deferPaymentsSetup)}
          >
            Do Later
          </DesignButton>
        }
        secondaryAction={selectedPaymentsCountry === "US" ? (
          <DesignButton
            className="rounded-full px-6"
            variant="outline"
            disabled={saving || paymentsSetupAction != null}
            loading={paymentsSetupAction === "connect"}
            onClick={() => runAsynchronouslyWithAlert(connectPaymentsSetup)}
          >
            Connect
          </DesignButton>
        ) : undefined}
      >
        <Suspense fallback={<PaymentsSetupStepSkeleton />}>
          <PaymentsSetupAutoComplete
            project={props.project}
            buildOnboardingState={buildOnboardingState}
            saveOnboardingProgress={saveOnboardingProgress}
          />
          <PaymentsSetupStepContent
            selectedPaymentsCountry={selectedPaymentsCountry}
            setSelectedPaymentsCountry={setSelectedPaymentsCountry}
          />
        </Suspense>
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

function EmailThemeSetupStepSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3" data-testid="email-theme-step-skeleton">
      {["theme-skeleton-one", "theme-skeleton-two", "theme-skeleton-three"].map((id) => (
        <div
          key={id}
          className="relative flex flex-col overflow-hidden rounded-2xl bg-white/90 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.10]"
        >
          <Skeleton className="aspect-[4/3] rounded-none border-b border-black/[0.06] bg-foreground/[0.08] dark:border-white/[0.06]" />
          <div className="flex items-center justify-between gap-2 p-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailThemeSetupStep({
  project,
  saving,
  selectedEmailThemeId,
  setSelectedEmailThemeId,
}: {
  project: AdminOwnedProject,
  saving: boolean,
  selectedEmailThemeId: string | null,
  setSelectedEmailThemeId: (themeId: string) => void,
}) {
  const emailThemes = project.app.useEmailThemes();

  return (
    <div className="space-y-4">
      {emailThemes.length === 0 && (
        <DesignAlert
          variant="warning"
          title="No themes found"
          description="Theme selection is temporarily unavailable. You can still continue."
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
              disabled={saving}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl text-left transition-[box-shadow,background-color] duration-150 hover:transition-none",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isSelected
                  ? cn(
                      "bg-blue-500/[0.06] dark:bg-blue-500/[0.04] ring-1 ring-blue-500/40",
                      "shadow-[0_12px_40px_-8px_rgba(59,130,246,0.45),0_0_1px_rgba(59,130,246,0.2)]",
                      "dark:shadow-[0_14px_48px_-10px_rgba(96,165,250,0.38),0_0_1px_rgba(96,165,250,0.25)]",
                    )
                  : cn(
                      "bg-white/90 dark:bg-white/[0.06]",
                      "ring-1 ring-black/[0.06] hover:ring-black/[0.10] dark:ring-white/[0.10] dark:hover:ring-white/[0.14]",
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
                  <OnboardingEmailThemePreview adminApp={project.app} themeId={theme.id} />
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
  );
}

function PaymentsSetupStepSkeleton() {
  return (
    <div className="mx-auto w-full max-w-sm" data-testid="payments-setup-step-skeleton">
      <div className="rounded-2xl bg-white/90 p-6 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.10] md:p-7">
        <div className="flex flex-col items-center gap-6 md:gap-7">
          <Skeleton className="h-7 w-40" />
          <div className="flex w-full flex-col gap-3 rounded-xl bg-foreground/[0.03] px-5 py-4">
            {["feature-skeleton-one", "feature-skeleton-two", "feature-skeleton-three"].map((id) => (
              <div key={id} className="flex items-center gap-2.5">
                <Skeleton className="h-3.5 w-3.5 rounded-full" />
                <Skeleton className="h-4 w-full max-w-[220px]" />
              </div>
            ))}
          </div>
          <div className="w-full space-y-2.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <div className="flex items-center justify-center gap-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentsSetupStepContent({
  selectedPaymentsCountry,
  setSelectedPaymentsCountry,
}: {
  selectedPaymentsCountry: OnboardingPaymentsCountry,
  setSelectedPaymentsCountry: (country: OnboardingPaymentsCountry) => void,
}) {
  return (
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
              onValueChange={(value) => {
                if (value !== "US" && value !== "OTHER") {
                  throw new Error(`Invalid payments country: ${value}`);
                }
                setSelectedPaymentsCountry(value);
              }}
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
  );
}

function PaymentsSetupAutoComplete({
  project,
  buildOnboardingState,
  saveOnboardingProgress,
}: {
  project: AdminOwnedProject,
  buildOnboardingState: () => ProjectOnboardingState,
  saveOnboardingProgress: (update: OnboardingProgressUpdate) => Promise<void>,
}) {
  const stripeAccountInfo = project.app.useStripeAccountInfo();
  const autoCompletingRef = useRef(false);

  useEffect(() => {
    if (stripeAccountInfo?.details_submitted !== true || autoCompletingRef.current) {
      return;
    }

    autoCompletingRef.current = true;
    runAsynchronouslyWithAlert(async () => {
      try {
        await saveOnboardingProgress({
          status: "welcome",
          onboardingState: buildOnboardingState(),
        });
      } catch (error) {
        autoCompletingRef.current = false;
        throw error;
      }
    });
  }, [buildOnboardingState, saveOnboardingProgress, stripeAccountInfo?.details_submitted]);

  return null;
}
