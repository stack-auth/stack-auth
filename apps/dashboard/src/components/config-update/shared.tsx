'use client';

import type { PushedConfigSource, StackAdminApp } from "@hexclave/next";
import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import type { HexclaveAdminInterface } from "@hexclave/shared/dist/interface/admin-interface";
import type { ConfigAgentRunApi } from "@hexclave/shared/dist/schema-fields";
import { createContext, useContext } from "react";

/** Live state of a dashboard→GitHub config agent run (mirrors the API schema). */
export type ConfigAgentRun = ConfigAgentRunApi;
export type ConfigAgentRunStatus = ConfigAgentRun["status"];
export type AgentStage = NonNullable<ConfigAgentRun["stage"]>;

export type GithubPushedSource = Extract<PushedConfigSource, { type: "pushed-from-github" }>;

export function currentEpochMsFromPerformance(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * Reaches the admin app's underlying `HexclaveAdminInterface`, which carries the
 * config-agent endpoints (`applyConfigViaAgent`, `cancelConfigAgentRun`,
 * `getConfigAgentRun`, `getPushedConfigSource`) we call directly — rather than via
 * generated app methods — to keep this feature self-contained. `_interface` is a
 * protected member, so we read it reflectively (the same pattern the SDK's own
 * cross-domain tests use). Returns `null` if the app doesn't expose one.
 */
export function getAdminInterface(adminApp: StackAdminApp<false> | null | undefined): HexclaveAdminInterface | null {
  if (adminApp == null) return null;
  // `Reflect.get` returns `any`; the typed annotation documents the contract
  // without an explicit cast (and without an `instanceof`, which is unreliable
  // across package-boundary copies of the class).
  const iface: HexclaveAdminInterface | undefined = Reflect.get(adminApp, "_interface");
  return iface ?? null;
}

export const ConfigUpdateDialogContext = createContext<{
  showPushableDialog: (adminApp: StackAdminApp<false>, configUpdate: EnvironmentConfigOverrideOverride) => Promise<boolean>,
  // True while THIS tab's push dialog is actively managing a started run, so the
  // page-load watcher (ConfigAgentRunWatcher) doesn't also pop its own modal for
  // the same run. The watcher owns the modal only for runs this tab didn't start
  // (other tabs / reloads).
  githubRunActive: boolean,
  setGithubRunActive: (active: boolean) => void,
} | null>(null);

/** Read-only accessor for the watcher (mounted below this provider). */
export function useGithubRunActive(): boolean {
  return useContext(ConfigUpdateDialogContext)?.githubRunActive ?? false;
}
