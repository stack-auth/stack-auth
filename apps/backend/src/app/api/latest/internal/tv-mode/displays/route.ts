import { getExactEndUserIp } from "@/lib/end-users";
import {
  approveTvDisplayPairing,
  consumeTvDisplayPairingRateLimit,
  listTvDisplays,
  refundTvDisplayPairingRateLimit,
  requireTvDisplayAdminUserId,
  TvDisplayOperationError,
} from "@/lib/tv-mode/displays";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TvDisplayResourceSchema } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

const adminAuthSchema = yupObject({
  type: adminAuthTypeSchema,
  tenancy: adaptSchema.defined(),
  adminUserId: yupString().uuid().optional(),
}).defined();

async function refundApprovalRateLimits(
  adminUserId: string,
  ip: string,
  now: Date,
): Promise<void> {
  const refundResults = await Promise.allSettled([
    refundTvDisplayPairingRateLimit({ identity: adminUserId, operation: "approval-admin", windowMs: 10 * 60_000, now }),
    refundTvDisplayPairingRateLimit({ identity: ip, operation: "approval-ip", windowMs: 10 * 60_000, now }),
  ]);
  for (const refundResult of refundResults) {
    if (refundResult.status === "rejected") {
      captureError("tv-display-rate-limit-refund-failed", new HexclaveAssertionError(
        "A TV display approval could not refund its rate-limit bucket.",
        { cause: refundResult.reason },
      ));
    }
  }
}

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: adminAuthSchema }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ displays: yupArray(TvDisplayResourceSchema).defined() }).noUnknown().defined(),
  }),
  handler: async ({ auth: { tenancy } }) => ({
    statusCode: 200,
    bodyType: "json",
    body: { displays: await listTvDisplays(tenancy) },
  }),
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: adminAuthSchema,
    body: yupObject({
      pairingCode: yupString().min(1).defined(),
      profileId: yupString().min(1).defined(),
      displayName: yupString().trim().min(1).max(80).defined(),
      acknowledgeExactFinancials: yupBoolean().defined(),
    }).noUnknown().defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
      approvedAt: yupString().defined(),
      expiresAt: yupString().defined(),
    }).noUnknown().defined(),
  }),
  handler: async ({ auth, body }) => {
    const adminUserId = requireTvDisplayAdminUserId(auth.adminUserId);
    const ip = await getExactEndUserIp() ?? "unknown-untrusted-ip";
    const rateLimitNow = new Date();
    const [adminAllowed, ipAllowed] = await Promise.all([
      consumeTvDisplayPairingRateLimit({
        identity: adminUserId,
        operation: "approval-admin",
        windowMs: 10 * 60_000,
        limit: 10,
        now: rateLimitNow,
      }),
      consumeTvDisplayPairingRateLimit({
        identity: ip,
        operation: "approval-ip",
        windowMs: 10 * 60_000,
        limit: 20,
        now: rateLimitNow,
      }),
    ]);
    if (!adminAllowed || !ipAllowed) {
      const refundResults = await Promise.allSettled([
        adminAllowed
          ? refundTvDisplayPairingRateLimit({ identity: adminUserId, operation: "approval-admin", windowMs: 10 * 60_000, now: rateLimitNow })
          : Promise.resolve(),
        ipAllowed
          ? refundTvDisplayPairingRateLimit({ identity: ip, operation: "approval-ip", windowMs: 10 * 60_000, now: rateLimitNow })
          : Promise.resolve(),
      ]);
      for (const refundResult of refundResults) {
        if (refundResult.status === "rejected") {
          captureError("tv-display-rate-limit-refund-failed", new HexclaveAssertionError(
            "A rejected TV display approval could not refund its rate-limit bucket.",
            { cause: refundResult.reason },
          ));
        }
      }
      throw new StatusError(429, "tv_display_pairing_rate_limited");
    }
    try {
      const approval = await approveTvDisplayPairing({
        tenancy: auth.tenancy,
        pairingCode: body.pairingCode,
        profileId: body.profileId,
        displayName: body.displayName,
        adminUserId,
        acknowledgeExactFinancials: body.acknowledgeExactFinancials,
      });
      await refundApprovalRateLimits(adminUserId, ip, rateLimitNow);
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          success: true,
          approvedAt: approval.approvedAt.toISOString(),
          expiresAt: approval.expiresAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof TvDisplayOperationError) {
        await refundApprovalRateLimits(adminUserId, ip, rateLimitNow);
        const status = error.code === "tv_display_profile_not_found"
          ? 404
          : error.code === "tv_display_exact_financials_acknowledgement_required"
            ? 428
            : 400;
        throw new StatusError(status, error.code);
      }
      throw error;
    }
  },
});
