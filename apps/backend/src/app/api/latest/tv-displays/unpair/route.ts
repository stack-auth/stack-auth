import { cookies } from "@/lib/runtime/headers";
import { getAuthorizedTvDisplay, revokeTvDisplay, TV_DISPLAY_REFRESH_COOKIE } from "@/lib/tv-mode/displays";
import { clearedTvDisplayRefreshCookieOptions } from "@/lib/tv-mode/display-refresh-cookie";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    headers: yupObject({ authorization: yupTuple([yupString().defined()]).optional() }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ success: yupBoolean().oneOf([true]).defined() }).noUnknown().defined(),
  }),
  handler: async ({ headers }) => {
    const authorization = headers.authorization?.[0];
    if (authorization == null || !authorization.startsWith("Bearer ")) throw new StatusError(401, "tv_display_access_required");
    const authorized = await getAuthorizedTvDisplay(authorization.slice("Bearer ".length));
    if (authorized == null) throw new StatusError(401, "tv_display_access_invalid");
    await revokeTvDisplay(authorized.tenancy, authorized.display.id, "SELF_UNPAIRED");
    const cookieStore = await cookies();
    cookieStore.set(TV_DISPLAY_REFRESH_COOKIE, "", clearedTvDisplayRefreshCookieOptions());
    return { statusCode: 200, bodyType: "json", body: { success: true } };
  },
});
