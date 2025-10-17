import { useContext } from "react";
import { StackContext } from "../providers/stack-provider-client";
import { GetUserOptions as AppGetUserOptions, CurrentInternalUser, CurrentUser, StackClientApp } from "./stack-app";

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
  const stackApp = useStackApp(options);
  if (options.projectIdMustMatch && stackApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useStackApp: " + stackApp.projectId);
  }
  if (options.projectIdMustMatch === "internal") {
    return stackApp.useUser(options) as CurrentInternalUser;
  } else {
    return stackApp.useUser(options) as CurrentUser;
  }
}

/**
 * Returns the current Stack app associated with the StackProvider.
 *
 * @returns the current Stack app
 */
export function useStackApp<ProjectId extends string>(options: { projectIdMustMatch?: ProjectId } = {}): StackClientApp<true, ProjectId> {
  if (typeof useContext !== "function") {
    throw new Error("useStackApp() can only be used in a React Client Component. Make sure you're not calling it from a Server Component, or any other environment.");
  }
  const context = useContext(StackContext);
  if (context === null) {
    throw new Error("useStackApp must be used within a StackProvider");
  }
  const stackApp = context.app;
  if (options.projectIdMustMatch && stackApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useStackApp: " + stackApp.projectId);
  }
  return stackApp as StackClientApp<true, ProjectId>;
}
