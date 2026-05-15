"use client";

import { getPublicEnvVar } from "@/lib/env";
import { useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

function isRemoteDevelopmentEnvironment(): boolean {
  return getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
}

export function useDashboardUser() {
  const user = useUser({
    or: isRemoteDevelopmentEnvironment() ? "anonymous-if-exists[deprecated]" : "redirect",
  });

  return user ?? throwErr("Dashboard expected a signed-in user because the protected dashboard auth gate should have installed or redirected the user.");
}

export function useDashboardInternalUser() {
  const user = useUser({
    or: isRemoteDevelopmentEnvironment() ? "anonymous-if-exists[deprecated]" : "redirect",
    projectIdMustMatch: "internal",
  });

  return user ?? throwErr("Dashboard expected an internal user because the protected dashboard auth gate should have installed or redirected the user.");
}
