import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { AdminOwnedProject } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { projectOnboardingStatusValues, type ProjectOnboardingStatus } from "@stackframe/stack-shared/dist/schema-fields";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

const PROJECT_ONBOARDING_STATUSES = projectOnboardingStatusValues;

export type SignInMethod = "credential" | "magicLink" | "passkey" | "google" | "github" | "microsoft";
export type OnboardingConfigChoice = "create-new" | "link-existing";
export type OnboardingPaymentsCountry = "US" | "OTHER";

export const SIGN_IN_METHODS: Array<{ id: SignInMethod, label: string }> = [
  { id: "credential", label: "Email & password" },
  { id: "magicLink", label: "Magic link / OTP" },
  { id: "passkey", label: "Passkey" },
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "microsoft", label: "Microsoft" },
];

export const REQUIRED_APP_IDS: AppId[] = ["authentication", "emails"];
export const PRIMARY_APP_IDS: AppId[] = ["authentication", "emails", "payments", "analytics"];
export const ALL_APP_IDS = Object.keys(ALL_APPS) as AppId[];
export const OAUTH_SIGN_IN_METHODS: SignInMethod[] = ["google", "github", "microsoft"];

export type ProjectOnboardingState = {
  selected_config_choice: OnboardingConfigChoice,
  selected_apps: AppId[],
  selected_sign_in_methods: SignInMethod[],
  selected_email_theme_id: string | null,
  selected_payments_country: OnboardingPaymentsCountry,
};

export type StackAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
  refreshOwnedProjects: () => Promise<void>,
};

export type TimelineStep = {
  id: ProjectOnboardingStatus,
  label: string,
};

export const PAYMENT_COUNTRY_OPTIONS = [
  { value: "US", label: "United States" },
  { value: "OTHER", label: "Other" },
] as const;

export function isProjectOnboardingState(value: unknown): value is ProjectOnboardingState {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const selectedConfigChoice = Reflect.get(value, "selected_config_choice");
  if (selectedConfigChoice !== "create-new" && selectedConfigChoice !== "link-existing") {
    return false;
  }
  const selectedApps = Reflect.get(value, "selected_apps");
  if (!Array.isArray(selectedApps) || !selectedApps.every((entry) => ALL_APP_IDS.some((appId) => appId === entry))) {
    return false;
  }
  const selectedSignInMethods = Reflect.get(value, "selected_sign_in_methods");
  if (
    !Array.isArray(selectedSignInMethods)
    || !selectedSignInMethods.every((entry) => SIGN_IN_METHODS.some((method) => method.id === entry))
  ) {
    return false;
  }
  const selectedEmailThemeId = Reflect.get(value, "selected_email_theme_id");
  if (selectedEmailThemeId !== null && typeof selectedEmailThemeId !== "string") {
    return false;
  }
  const selectedPaymentsCountry = Reflect.get(value, "selected_payments_country");
  if (selectedPaymentsCountry !== "US" && selectedPaymentsCountry !== "OTHER") {
    return false;
  }
  return true;
}

export function normalizeProjectOnboardingState(
  value: ProjectOnboardingState,
  options?: { localEmulator: boolean },
): ProjectOnboardingState {
  const selectedApps = ALL_APP_IDS.filter((appId) => value.selected_apps.some((selectedAppId) => selectedAppId === appId));
  const selectedSignInMethods = SIGN_IN_METHODS
    .map((method) => method.id)
    .filter((methodId) => value.selected_sign_in_methods.some((selectedMethodId) => selectedMethodId === methodId));
  const localEmulator = options?.localEmulator === true;
  const normalizedSignInMethods = localEmulator
    ? selectedSignInMethods.filter((methodId) => !OAUTH_SIGN_IN_METHODS.some((oauthMethod) => oauthMethod === methodId))
    : selectedSignInMethods;
  return {
    selected_config_choice: localEmulator ? "create-new" : value.selected_config_choice,
    selected_apps: selectedApps,
    selected_sign_in_methods: normalizedSignInMethods,
    selected_email_theme_id: value.selected_email_theme_id,
    selected_payments_country: value.selected_payments_country,
  };
}

export function createProjectOnboardingState(options: {
  selectedConfigChoice: OnboardingConfigChoice,
  selectedApps: Set<AppId>,
  selectedSignInMethods: Set<SignInMethod>,
  selectedEmailThemeId: string | null,
  selectedPaymentsCountry: OnboardingPaymentsCountry,
  localEmulator: boolean,
}): ProjectOnboardingState {
  return normalizeProjectOnboardingState({
    selected_config_choice: options.selectedConfigChoice,
    selected_apps: ALL_APP_IDS.filter((appId) => options.selectedApps.has(appId)),
    selected_sign_in_methods: SIGN_IN_METHODS
      .map((method) => method.id)
      .filter((methodId) => options.selectedSignInMethods.has(methodId)),
    selected_email_theme_id: options.selectedEmailThemeId,
    selected_payments_country: options.selectedPaymentsCountry,
  }, { localEmulator: options.localEmulator });
}

export function isStackAppInternals(value: unknown): value is StackAppInternals {
  return (
    value != null
    && typeof value === "object"
    && "sendRequest" in value
    && typeof value.sendRequest === "function"
    && "refreshOwnedProjects" in value
    && typeof value.refreshOwnedProjects === "function"
  );
}

export function getStackAppInternals(appValue: unknown): StackAppInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }

  const internals = Reflect.get(appValue, stackAppInternalsSymbol);
  if (!isStackAppInternals(internals)) {
    throw new Error("The Stack client app cannot send internal requests.");
  }

  return internals;
}

export function isProjectOnboardingStatus(value: unknown): value is ProjectOnboardingStatus {
  return typeof value === "string" && PROJECT_ONBOARDING_STATUSES.some((status) => status === value);
}

export function orderedAppIds() {
  const primarySet = new Set(PRIMARY_APP_IDS);
  const secondary = ALL_APP_IDS.filter((appId) => !primarySet.has(appId)).sort((a, b) => {
    return stringCompare(ALL_APPS[a].displayName, ALL_APPS[b].displayName);
  });
  return [...PRIMARY_APP_IDS, ...secondary];
}

export function normalizeTrustedDomain(input: string): string {
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

export function buildTimeline(includePayments: boolean): TimelineStep[] {
  const timeline: TimelineStep[] = [
    { id: "config_choice", label: "Config" },
    { id: "apps_selection", label: "Apps" },
    { id: "auth_setup", label: "Auth" },
    { id: "email_theme_setup", label: "Email Theme" },
  ];

  if (includePayments) {
    timeline.push({ id: "payments_setup", label: "Payments" });
  }

  timeline.push({ id: "welcome", label: "Finish" });
  return timeline;
}

export function buildLinkExistingTimeline(includePayments: boolean): TimelineStep[] {
  const timeline: TimelineStep[] = [
    { id: "config_choice", label: "Config" },
  ];

  if (includePayments) {
    timeline.push({ id: "payments_setup", label: "Payments" });
  }

  timeline.push({ id: "welcome", label: "Finish" });
  return timeline;
}

export function beginPendingAction(
  pendingRef: { current: boolean },
  setPending: (value: boolean) => void,
) {
  if (pendingRef.current) {
    return false;
  }

  pendingRef.current = true;
  setPending(true);
  return true;
}

export function endPendingAction(
  pendingRef: { current: boolean },
  setPending: (value: boolean) => void,
) {
  pendingRef.current = false;
  setPending(false);
}

export function deriveInitialSignInMethods(project: AdminOwnedProject, status: ProjectOnboardingStatus): Set<SignInMethod> {
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

export function deriveInitialApps(config: ReturnType<AdminOwnedProject["useConfig"]>, status: ProjectOnboardingStatus): Set<AppId> {
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

export function getStepIndex(steps: TimelineStep[], stepId: ProjectOnboardingStatus) {
  return steps.findIndex((step) => step.id === stepId);
}
