// Retained only for backwards compatibility with config files that still import
// from `<pkg>/config` (e.g. `@hexclave/next/config`). New config files should
// import `defineHexclaveConfig` and the config types from the SDK package root
// (e.g. `@hexclave/next`) — the SDK roots are side-effect-free enough to load in
// a plain Node context (as the local dashboard and CLI do), so the separate
// `/config` entrypoint is no longer necessary and is not recommended anymore.
//
// Hexclave aliases and legacy Stack* names — @deprecated JSDoc lives on the
// original declarations in @hexclave/shared/config so it survives dts bundling
// (per-specifier JSDoc on re-exports does not).
export type { HexclaveConfig, StackConfig } from "@hexclave/shared/config";
export { defineHexclaveConfig, defineStackConfig, showOnboardingHexclaveConfigValue } from "@hexclave/shared/config";
