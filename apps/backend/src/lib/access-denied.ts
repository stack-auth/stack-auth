import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { getEndUserIpInfoForEvent, logEvent, SystemEventTypes } from "./events";
import { Tenancy } from "./tenancies";

export type AccessDeniedReason =
  | "failed_password"
  | "failed_otp"
  | "failed_passkey"
  | "restricted_user"
  | "permission_denied"
  | "oauth_provider_denied";

export type AccessDeniedOptions = {
  userId?: string | null,
  email?: string | null,
  authMethod?: string | null,
  oauthProvider?: string | null,
  permissionId?: string | null,
  teamId?: string | null,
  restrictedReason?: string | null,
};

export async function logAccessDenied(
  tenancy: Tenancy,
  reason: AccessDeniedReason,
  options: AccessDeniedOptions = {},
): Promise<void> {
  try {
    const ipInfo = await getEndUserIpInfoForEvent();
    await logEvent([SystemEventTypes.AccessDenied], {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      userId: options.userId ?? null,
      reason,
      email: options.email ?? null,
      authMethod: options.authMethod ?? null,
      oauthProvider: options.oauthProvider ?? null,
      permissionId: options.permissionId ?? null,
      teamId: options.teamId ?? null,
      restrictedReason: options.restrictedReason ?? null,
      ipInfo,
    }, {
      billingTeamId: null,
    });
  } catch (e) {
    captureError("access-denied-log-error", new HexclaveAssertionError(
      `Failed to log access denied event for reason ${reason}`,
      { cause: e },
    ));
  }
}

export function logAccessDeniedInBackground(
  tenancy: Tenancy,
  reason: AccessDeniedReason,
  options: AccessDeniedOptions = {},
): void {
  runAsynchronouslyAndWaitUntil(logAccessDenied(tenancy, reason, options));
}
