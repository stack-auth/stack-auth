import { cookies } from "@/lib/runtime/headers";
import { refreshTvDisplayCredential, TV_DISPLAY_REFRESH_COOKIE } from "@/lib/tv-mode/displays";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({ auth: yupObject({}).nullable().optional() }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ accessToken: yupString().defined() }).noUnknown().defined(),
  }),
  handler: async () => {
    const cookieStore = await cookies();
    const rawRefreshToken = cookieStore.get(TV_DISPLAY_REFRESH_COOKIE)?.value;
    if (rawRefreshToken == null) throw new StatusError(401, "tv_display_refresh_required");
    const result = await refreshTvDisplayCredential(rawRefreshToken);
    if (result == null) {
      cookieStore.set(TV_DISPLAY_REFRESH_COOKIE, "", {
        httpOnly: true,
        secure: getNodeEnvironment() !== "development" && getNodeEnvironment() !== "test",
        sameSite: "strict",
        path: "/api/latest/tv-displays",
        expires: new Date(0),
        maxAge: 0,
      });
      throw new StatusError(401, "tv_display_refresh_invalid");
    }
    cookieStore.set(TV_DISPLAY_REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: getNodeEnvironment() !== "development" && getNodeEnvironment() !== "test",
      sameSite: "strict",
      path: "/api/latest/tv-displays",
      maxAge: 90 * 24 * 60 * 60,
    });
    return { statusCode: 200, bodyType: "json", body: { accessToken: result.accessToken } };
  },
});
