import { useContext } from "react";
import { HexclaveContext } from "../providers/hexclave-context";
import type { GetUserOptions as AppGetUserOptions, CurrentInternalUser, CurrentUser, StackClientApp } from "./hexclave-app";

type GetUserOptions = AppGetUserOptions<true> & {
  projectIdMustMatch?: string,
};

/**
 * Returns the current user object. Equivalent to `useStackApp().useUser()`.
 *
 * @returns the current user
 */
export function useUser(options: GetUserOptions & { or: 'redirect' | 'throw', projectIdMustMatch: "internal" }): CurrentInternalUser;
export function useUser(options: GetUserOptions & { or: 'redirect' | 'throw' }): CurrentUser;
export function useUser(options: GetUserOptions & { projectIdMustMatch: "internal" }): CurrentInternalUser | null;
export function useUser(options?: GetUserOptions): CurrentUser | CurrentInternalUser | null;
export function useUser(options: GetUserOptions = {}): CurrentUser | CurrentInternalUser | null {
  const hexclaveApp = useHexclaveApp(options);
  if (options.projectIdMustMatch && hexclaveApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useHexclaveApp: " + hexclaveApp.projectId);
  }
  if (options.projectIdMustMatch === "internal") {
    return hexclaveApp.useUser(options) as CurrentInternalUser;
  } else {
    return hexclaveApp.useUser(options) as CurrentUser;
  }
}

/**
 * Returns the current Hexclave app associated with the HexclaveProvider.
 *
 * @returns the current Hexclave app
 */
export function useHexclaveApp<ProjectId extends string>(options: { projectIdMustMatch?: ProjectId } = {}): StackClientApp<true, ProjectId> {
  if (typeof useContext !== "function") {
    throw new Error("useHexclaveApp() can only be used in a React Client Component. Make sure you're not calling it from a Server Component, or any other environment.");
  }
  const context = useContext(HexclaveContext);
  if (context === null) {
    throw new Error("useHexclaveApp must be used within a HexclaveProvider");
  }
  const hexclaveApp = context.app;
  if (options.projectIdMustMatch && hexclaveApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useHexclaveApp: " + hexclaveApp.projectId);
  }
  return hexclaveApp as StackClientApp<true, ProjectId>;
}

/**
 * Returns the current Stack app associated with the StackProvider.
 *
 * @deprecated Use `useHexclaveApp` from the `@hexclave/*` package instead — same symbol, new brand name. See https://docs.hexclave.com/migration.
 *
 * @returns the current Stack app
 */
export function useStackApp<ProjectId extends string>(options: { projectIdMustMatch?: ProjectId } = {}): StackClientApp<true, ProjectId> {
  return useHexclaveApp(options);
}
