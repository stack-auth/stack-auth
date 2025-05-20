import { createAuthTokens } from "@/lib/tokens";
import { CrudHandlerInvocationError } from "@/route-handlers/crud-handler";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, userIdOrMeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { usersCrudHandlers } from "../../users/crud";
import { sessionsCrudHandlers } from "./crud";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create session",
    description: "Create a new session for a given user. This will return a refresh token that can be used to impersonate the user.",
    tags: ["Sessions"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      user_id: userIdOrMeSchema.defined(),
      expires_in_millis: yupNumber().max(1000 * 60 * 60 * 24 * 367).default(1000 * 60 * 60 * 24 * 365),
      is_impersonation: yupBoolean().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      refresh_token: yupString().defined(),
      access_token: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { user_id: userId, expires_in_millis: expiresInMillis, is_impersonation: isImpersonation } }) {
    let user;
    try {
      user = await usersCrudHandlers.adminRead({
        user_id: userId,
        tenancy: tenancy,
      });
    } catch (e) {
      if (e instanceof CrudHandlerInvocationError && KnownErrors.UserNotFound.isInstance(e.cause)) {
        throw new KnownErrors.UserIdDoesNotExist(userId);
      }
      throw e;
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: user.id,
      expiresAt: new Date(Date.now() + expiresInMillis),
      isImpersonation: isImpersonation,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        refresh_token: refreshToken,
        access_token: accessToken,
      }
    };
  },
});

export const GET = sessionsCrudHandlers.listHandler;
