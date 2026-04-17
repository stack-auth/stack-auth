import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { AdminOwnedProject } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { projectOnboardingStatusValues, type ProjectOnboardingStatus } from "@stackframe/stack-shared/dist/schema-fields";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

const PROJECT_ONBOARDING_STATUSES = projectOnboardingStatusValues;

export type SignInMethod = "credential" | "magicLink" | "passkey" | "google" | "github" | "microsoft";

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
