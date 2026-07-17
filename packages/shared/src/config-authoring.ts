import type { BranchConfigNormalizedOverride } from "./config/schema";

type StackConfigObject = BranchConfigNormalizedOverride;
export const showOnboardingHexclaveConfigValue = "show-onboarding";
/** @deprecated Use `HexclaveConfig` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export type StackConfig = StackConfigObject | typeof showOnboardingHexclaveConfigValue;

// Hexclave alias — same shape, declared separately so it doesn't inherit the deprecation tag.
export type HexclaveConfig = StackConfigObject | typeof showOnboardingHexclaveConfigValue;

type StrictConfigShape<Actual, Expected> =
  Expected extends readonly unknown[]
      ? Actual extends readonly unknown[]
      ? { [K in keyof Actual]: K extends keyof Expected ? StrictConfigShape<Actual[K], Expected[K]> : never }
        : Actual
    : Expected extends object
        ? Actual extends object
        ? Exclude<keyof Actual, keyof Expected> extends never
          ? { [K in keyof Actual]: K extends keyof Expected ? StrictConfigShape<Actual[K], Expected[K]> : never }
            : never
          : Actual
        : Actual;

type StrictStackConfig<T extends StackConfig> =
  T extends StackConfigObject
    ? T & StrictConfigShape<T, StackConfigObject>
    : T;

/** @deprecated Use `defineHexclaveConfig` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration. */
export function defineStackConfig(config: StrictStackConfig<StackConfig>): StackConfig {
  return config;
}

/**
 * Defines a Hexclave project configuration as code. See the documentation at https://skill.hexclave.com for more information.
 */
export function defineHexclaveConfig(config: StrictStackConfig<HexclaveConfig>): HexclaveConfig {
  return config;
}
