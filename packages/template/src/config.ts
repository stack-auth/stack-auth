// Lightweight, side-effect-free entrypoint for authoring `hexclave.config.ts`
// files. Importing from here (e.g. `@hexclave/next/config`) gives you the
// `defineHexclaveConfig` helper and config types WITHOUT pulling in the
// framework runtime (React, server-only, Next.js internals). That matters
// because tooling such as the local dashboard evaluates your config file in a
// plain Node context — importing `defineHexclaveConfig` from the package root
// would drag in the whole SDK and fail to load.
//
// Hexclave aliases and legacy Stack* names — @deprecated JSDoc lives on the
// original declarations in @hexclave/shared/config so it survives dts bundling
// (per-specifier JSDoc on re-exports does not).
export type { HexclaveConfig, StackConfig } from "@hexclave/shared/config";
export { defineHexclaveConfig, defineStackConfig, showOnboardingHexclaveConfigValue } from "@hexclave/shared/config";
