import type { BranchConfigNormalizedOverride } from "./config/schema";

type StackConfigObject = BranchConfigNormalizedOverride;
export const showOnboardingStackConfigValue = "show-onboarding";
export type StackConfig = StackConfigObject | typeof showOnboardingStackConfigValue;

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

export function defineStackConfig<const T extends StackConfig>(config: StrictStackConfig<T>): T {
  return config;
}
