import { cookies } from "@/lib/runtime/headers";
import { getTvDisplayResource, pollTvDisplayPairing, TV_DISPLAY_REFRESH_COOKIE } from "@/lib/tv-mode/displays";
import { getTenancy } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TvDisplayPairingStatusSchema } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    params: yupObject({ challengeId: yupString().uuid().defined() }).defined(),
    body: yupObject({ deviceSecret: yupString().defined() }).noUnknown().defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: TvDisplayPairingStatusSchema,
  }),
  handler: async ({ params, body }) => {
    const result = await pollTvDisplayPairing({ challengeId: params.challengeId, deviceSecret: body.deviceSecret });
    if (result.status !== "paired") return { statusCode: 200, bodyType: "json", body: result };
    const cookieStore = await cookies();
    cookieStore.set(TV_DISPLAY_REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: getNodeEnvironment() !== "development" && getNodeEnvironment() !== "test",
      sameSite: "strict",
      path: "/api/latest/tv-displays",
      maxAge: 90 * 24 * 60 * 60,
    });
    const tenancy = await getTenancy(result.display.tenancyId) ?? throwErr("Paired TV display tenancy no longer exists.");
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        status: result.status,
        accessToken: result.accessToken,
        display: await getTvDisplayResource(tenancy, result.display),
      },
    };
  },
});
