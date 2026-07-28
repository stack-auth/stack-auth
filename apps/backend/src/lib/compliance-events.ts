import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { logEvent, getEndUserIpInfoForEvent, SystemEventTypes } from "./events";
import { Tenancy } from "./tenancies";

type SignInAttemptOptions = {
  outcome: "success" | "failed",
  method: "password" | "otp" | "passkey" | "oauth",
  failureReason?: string | null,
  email?: string | null,
  oauthProvider?: string | null,
  userId?: string | null,
};

type PermissionDeniedOptions = {
  permissionId: string,
  teamId?: string | null,
  scope: "team" | "project",
  userId?: string | null,
};

type UserRestrictedOptions = {
  userId: string,
  restrictedReason: string,
};

async function logSignInAttempt(tenancy: Tenancy, options: SignInAttemptOptions): Promise<void> {
  try {
    const ipInfo = await getEndUserIpInfoForEvent();
    await logEvent([SystemEventTypes.SignInAttempt], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      userId: options.userId ?? null,
      outcome: options.outcome,
      method: options.method,
      failureReason: options.failureReason ?? null,
      email: options.email ?? null,
      oauthProvider: options.oauthProvider ?? null,
      ipInfo,
    }, {
      billingTeamId: null,
    });
  } catch (error) {
    captureError("compliance-event-log-error", new HexclaveAssertionError(
      "Failed to log sign-in attempt compliance event",
      { cause: error },
    ));
  }
}

async function logPermissionDenied(tenancy: Tenancy, options: PermissionDeniedOptions): Promise<void> {
  try {
    const ipInfo = await getEndUserIpInfoForEvent();
    await logEvent([SystemEventTypes.PermissionCheck], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      userId: options.userId ?? null,
      outcome: "denied",
      permissionId: options.permissionId,
      teamId: options.teamId ?? null,
      scope: options.scope,
      ipInfo,
    }, {
      billingTeamId: null,
    });
  } catch (error) {
    captureError("compliance-event-log-error", new HexclaveAssertionError(
      "Failed to log permission denial compliance event",
      { cause: error },
    ));
  }
}

async function logUserRestricted(tenancy: Tenancy, options: UserRestrictedOptions): Promise<void> {
  try {
    const ipInfo = await getEndUserIpInfoForEvent();
    await logEvent([SystemEventTypes.UserRestricted], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      userId: options.userId,
      restrictedReason: options.restrictedReason,
      ipInfo,
    }, {
      billingTeamId: null,
    });
  } catch (error) {
    captureError("compliance-event-log-error", new HexclaveAssertionError(
      "Failed to log restricted-user compliance event",
      { cause: error },
    ));
  }
}

export function logSignInAttemptInBackground(tenancy: Tenancy, options: SignInAttemptOptions): void {
  runAsynchronouslyAndWaitUntil(logSignInAttempt(tenancy, options));
}

export function logPermissionDeniedInBackground(tenancy: Tenancy, options: PermissionDeniedOptions): void {
  runAsynchronouslyAndWaitUntil(logPermissionDenied(tenancy, options));
}

export function logUserRestrictedInBackground(tenancy: Tenancy, options: UserRestrictedOptions): void {
  runAsynchronouslyAndWaitUntil(logUserRestricted(tenancy, options));
}
