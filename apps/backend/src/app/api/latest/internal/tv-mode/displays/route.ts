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
    body: yupObject({ success: yupBoolean().oneOf([true]).defined() }).noUnknown().defined(),
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
    if (!adminAllowed || !ipAllowed) throw new StatusError(429, "tv_display_pairing_rate_limited");
    try {
      await approveTvDisplayPairing({
        tenancy: auth.tenancy,
        pairingCode: body.pairingCode,
        profileId: body.profileId,
        displayName: body.displayName,
        adminUserId,
        acknowledgeExactFinancials: body.acknowledgeExactFinancials,
      });
      const refundResults = await Promise.allSettled([
        refundTvDisplayPairingRateLimit({ identity: adminUserId, operation: "approval-admin", windowMs: 10 * 60_000, now: rateLimitNow }),
        refundTvDisplayPairingRateLimit({ identity: ip, operation: "approval-ip", windowMs: 10 * 60_000, now: rateLimitNow }),
      ]);
      for (const refundResult of refundResults) {
        if (refundResult.status === "rejected") {
          captureError("tv-display-rate-limit-refund-failed", new HexclaveAssertionError(
            "A successful TV display approval could not refund its rate-limit bucket.",
            { cause: refundResult.reason },
          ));
        }
      }
    } catch (error) {
      if (error instanceof TvDisplayOperationError) {
        const status = error.code === "tv_display_profile_not_found" ? 404 : 400;
        throw new StatusError(status, error.code);
      }
      throw error;
    }
    return { statusCode: 200, bodyType: "json", body: { success: true } };
  },
});
