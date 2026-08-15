import { getExactEndUserIp } from "@/lib/end-users";
import { approveTvDisplayPairing, consumeTvDisplayPairingRateLimit, listTvDisplays, refundTvDisplayPairingRateLimit } from "@/lib/tv-mode/displays";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TvDisplayResourceSchema } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const adminAuthSchema = yupObject({
  type: adminAuthTypeSchema,
  tenancy: adaptSchema.defined(),
  adminUserId: yupString().uuid().defined(),
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
    const ip = await getExactEndUserIp() ?? "unknown-untrusted-ip";
    const [adminAllowed, ipAllowed] = await Promise.all([
      consumeTvDisplayPairingRateLimit({
        identity: auth.adminUserId,
        operation: "approval-admin",
        windowMs: 10 * 60_000,
        limit: 10,
      }),
      consumeTvDisplayPairingRateLimit({
        identity: ip,
        operation: "approval-ip",
        windowMs: 10 * 60_000,
        limit: 20,
      }),
    ]);
    if (!adminAllowed || !ipAllowed) throw new StatusError(429, "tv_display_pairing_rate_limited");
    try {
      await approveTvDisplayPairing({
        tenancy: auth.tenancy,
        pairingCode: body.pairingCode,
        profileId: body.profileId,
        displayName: body.displayName,
        adminUserId: auth.adminUserId,
        acknowledgeExactFinancials: body.acknowledgeExactFinancials,
      });
      await Promise.all([
        refundTvDisplayPairingRateLimit({ identity: auth.adminUserId, operation: "approval-admin", windowMs: 10 * 60_000 }),
        refundTvDisplayPairingRateLimit({ identity: ip, operation: "approval-ip", windowMs: 10 * 60_000 }),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === "tv_display_exact_financials_acknowledgement_required") {
        throw new StatusError(400, error.message);
      }
      if (error instanceof Error && error.message === "tv_display_profile_not_found") {
        throw new StatusError(404, error.message);
      }
      if (error instanceof Error && error.message === "tv_display_pairing_code_invalid") {
        throw new StatusError(400, error.message);
      }
      throw error;
    }
    return { statusCode: 200, bodyType: "json", body: { success: true } };
  },
});
