import { getAuthorizedTvDisplay } from "@/lib/tv-mode/displays";
import { resolveTvProfile } from "@/lib/tv-mode/profiles";
import { buildLiveTvSnapshot } from "@/lib/tv-mode/snapshot";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TvSnapshotSchema } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    headers: yupObject({ authorization: yupTuple([yupString().defined()]).optional() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: TvSnapshotSchema,
  }),
  handler: async ({ headers }) => {
    const authorization = headers.authorization?.[0];
    if (authorization == null || !authorization.startsWith("Bearer ")) throw new StatusError(401, "tv_display_access_required");
    const authorized = await getAuthorizedTvDisplay(authorization.slice("Bearer ".length));
    if (authorized == null) throw new StatusError(401, "tv_display_access_invalid");
    const profile = await resolveTvProfile(authorized.tenancy, authorized.display.profileId);
    if (profile == null) throw new StatusError(409, "tv_display_profile_unavailable");
    const acknowledgedAt = authorized.display.financialVisibilityAcknowledgedAt;
    const exactFinancialsAcknowledged = profile.configuration.financialVisibility !== "exact"
      || (acknowledgedAt != null && (profile.updatedAt == null || acknowledgedAt >= new Date(profile.updatedAt)));
    const snapshot = await buildLiveTvSnapshot({
      tenancy: authorized.tenancy,
      profileId: authorized.display.profileId,
      includeScreenDurations: true,
      forceFinancialRedaction: !exactFinancialsAcknowledged,
    });
    if (snapshot == null) throw new StatusError(409, "tv_display_profile_unavailable");
    return { statusCode: 200, bodyType: "json", body: snapshot };
  },
});
