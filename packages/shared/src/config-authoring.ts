import type { BranchConfigNormalizedOverride } from "./config/schema";

// A config file is an *override*, not a fully-normalized config: any value may be
// `null` to mean "remove this key and fall back to the default" (this is how the
// runtime `normalize` step interprets null). The normalized schema type forbids
// null, so re-add it on every value — recursively, preserving the exact key set
// and enums — so authors can write e.g. `oauth: { providers: { google: null } }`
// to reset a field while typos and bad enum values are still caught.
type NullableConfigValues<T> =
  T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]: NullableConfigValues<T[K]> | null }
      : T;

type StackConfigObject = NullableConfigValues<BranchConfigNormalizedOverride>;
export const showOnboardingHexclaveConfigValue = "show-onboarding";
/** @deprecated Use `HexclaveConfig` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackConfig = StackConfigObject | typeof showOnboardingHexclaveConfigValue;

// Hexclave alias — same shape, declared separately so it doesn't inherit the deprecation tag.
export type HexclaveConfig = StackConfigObject | typeof showOnboardingHexclaveConfigValue;

// `Expected` values are nullable (see `NullableConfigValues`); strip the `null`
// with `NonNullable` before inspecting structure so excess-key detection still
// works, while a literal `null` on the `Actual` side is always allowed through.
type StrictConfigShape<Actual, Expected, E = NonNullable<Expected>> =
  Actual extends null
    ? Actual
    : E extends readonly unknown[]
      ? Actual extends readonly unknown[]
        ? { [K in keyof Actual]: K extends keyof E ? StrictConfigShape<Actual[K], E[K]> : never }
        : Actual
      : E extends object
        ? Actual extends object
          ? Exclude<keyof Actual, keyof E> extends never
            ? { [K in keyof Actual]: K extends keyof E ? StrictConfigShape<Actual[K], E[K]> : never }
            : never
          : Actual
        : Actual;

type StrictStackConfig<T extends StackConfig> =
  T extends StackConfigObject
    ? T & StrictConfigShape<T, StackConfigObject>
    : T;

/** @deprecated Use `defineHexclaveConfig` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export function defineStackConfig<const T extends StackConfig>(config: StrictStackConfig<T>): T {
  return config;
}

// Hexclave alias — separate function so it does not inherit the deprecation tag.
export function defineHexclaveConfig<const T extends HexclaveConfig>(config: StrictStackConfig<T>): T {
  return config;
}
