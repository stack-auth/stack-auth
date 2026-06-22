import { getApiUrlForRequest } from "@/lib/request-api-url";
import { createAuthTokens } from "@/lib/tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { usersCrudHandlers } from "../../../users/crud";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Sign up anonymously",
    description: "Create a new anonymous account with no email",
    tags: ["Anonymous"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      project: adaptSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
      refresh_token: yupString().defined(),
      user_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { project, type, tenancy } }, fullReq) {
    // Guest sign-in is gated by its own toggle, intentionally INDEPENDENT of `auth.allowSignUp`:
    // admins commonly disable open sign-up while still wanting a "try as guest" affordance (and vice
    // versa). See packages/shared/src/config/schema.ts (branchAuthSchema.anonymous).
    if (!tenancy.config.auth.anonymous.allowSignIn) {
      throw new KnownErrors.AnonymousAccountsNotEnabled();
    }

    const createdUser = await usersCrudHandlers.adminCreate({
      tenancy,
      data: {
        is_anonymous: true,
      },
      allowedErrorTypes: [],
    });

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: createdUser.id,
      apiUrl: getApiUrlForRequest(fullReq),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: createdUser.id,
      },
    };
  },
});
