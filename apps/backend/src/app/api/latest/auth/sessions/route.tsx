import { getApiUrlForRequest } from "@/lib/request-api-url";
import { createAuthTokens } from "@/lib/tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, serverOrHigherAuthTypeSchema, userIdOrMeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { isScope, parseScopeString } from "@hexclave/shared/dist/scopes";
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
      // Space-separated list of scopes to restrict the created session to (OAuth `scope`
      // convention). Omitted = unrestricted session. Access tokens minted from this session
      // carry these scopes and are gated by each endpoint's `requiredScopes`. See `scopes.ts`.
      scope: yupString().optional(),
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
  async handler({ auth: { tenancy }, body: { user_id: userId, expires_in_millis: expiresInMillis, is_impersonation: isImpersonation, scope } }, fullReq) {
    // Validate requested scopes against the registry up front so callers get a clear error
    // instead of silently minting a token with a bogus scope that can never satisfy any endpoint.
    const requestedScopes = parseScopeString(scope);
    const unknownScopes = requestedScopes.filter((s) => !isScope(s));
    if (unknownScopes.length > 0) {
      throw new KnownErrors.SchemaError(`Unknown scope(s): ${unknownScopes.map((s) => `'${s}'`).join(", ")}.`);
    }

    let user;
    try {
      user = await usersCrudHandlers.adminRead({
        user_id: userId,
        tenancy: tenancy,
        allowedErrorTypes: [
          KnownErrors.UserNotFound,
        ],
      });
    } catch (e) {
      if (KnownErrors.UserNotFound.isInstance(e)) {
        throw new KnownErrors.UserIdDoesNotExist(userId);
      }
      throw e;
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: user.id,
      expiresAt: new Date(Date.now() + expiresInMillis),
      isImpersonation: isImpersonation,
      apiUrl: getApiUrlForRequest(fullReq),
      scopes: requestedScopes,
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
