import {
  requireTvDisplayAdminUserId,
  revokeTvDisplay,
  TvDisplayOperationError,
  updateTvDisplay,
} from "@/lib/tv-mode/displays";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const authSchema = yupObject({
  type: adminAuthTypeSchema,
  tenancy: adaptSchema.defined(),
  adminUserId: yupString().uuid().optional(),
}).defined();
const paramsSchema = yupObject({ displayId: yupString().uuid().defined() }).defined();
const successResponse = yupObject({
  statusCode: yupNumber().oneOf([200]).defined(),
  bodyType: yupString().oneOf(["json"]).defined(),
  body: yupObject({ success: yupBoolean().oneOf([true]).defined() }).noUnknown().defined(),
});

export const PATCH = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
    body: yupObject({
      displayName: yupString().trim().min(1).max(80).defined(),
      profileId: yupString().defined(),
      acknowledgeExactFinancials: yupBoolean().defined(),
    }).noUnknown().defined(),
  }),
  response: successResponse,
  handler: async ({ auth, params, body }) => {
    const adminUserId = requireTvDisplayAdminUserId(auth.adminUserId);
    try {
      const updated = await updateTvDisplay({
        tenancy: auth.tenancy,
        displayId: params.displayId,
        displayName: body.displayName,
        profileId: body.profileId,
        adminUserId,
        acknowledgeExactFinancials: body.acknowledgeExactFinancials,
      });
      if (!updated) throw new StatusError(404, "tv_display_not_found");
      return { statusCode: 200, bodyType: "json", body: { success: true } };
    } catch (error) {
      if (error instanceof TvDisplayOperationError) {
        const status = error.code === "tv_display_profile_not_found" ? 404 : 400;
        throw new StatusError(status, error.code);
      }
      throw error;
    }
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: authSchema, params: paramsSchema }),
  response: successResponse,
  handler: async ({ auth, params }) => {
    const adminUserId = requireTvDisplayAdminUserId(auth.adminUserId);
    const revoked = await revokeTvDisplay(auth.tenancy, params.displayId, "ADMIN_REVOKED", new Date(), adminUserId);
    if (!revoked) throw new StatusError(404, "tv_display_not_found");
    return { statusCode: 200, bodyType: "json", body: { success: true } };
  },
});
