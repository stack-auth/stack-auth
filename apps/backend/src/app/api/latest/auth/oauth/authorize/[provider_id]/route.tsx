import { checkApiKeySet, throwCheckApiKeySetError } from "@/lib/internal-api-keys";
import { isAcceptedNativeAppUrl, validateRedirectUrl } from "@/lib/redirect-urls";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { decodeAccessToken, oauthCookieSchema } from "@/lib/tokens";
import { botChallengeFlowRequestSchemaFields, getRequestContextAndBotChallengeAssessment } from "@/lib/turnstile";
import { getProjectBranchFromClientId, getProvider } from "@/oauth";
import { globalPrismaClient } from "@/prisma-client";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { urlSchema, yupArray, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { generators } from "openid-client";
import type { InferType, Schema } from "yup";

const outerOAuthFlowExpirationInMinutes = 10;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "OAuth authorize endpoint",
    description: "This endpoint is used to initiate the OAuth authorization flow. there are two purposes for this endpoint: 1. Authenticate a user with an OAuth provider. 2. Link an existing user with an OAuth provider.",
    tags: ["Oauth"],
  },
  request: yupObject({
    params: yupObject({
      provider_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      // custom parameters
      type: yupString().oneOf(["authenticate", "link"]).default("authenticate"),
      token: yupString().default(""),
      provider_scope: yupString().optional(),
      /**
       * @deprecated
       */
      error_redirect_url: urlSchema.optional().meta({ openapiField: { hidden: true } }),
      error_redirect_uri: urlSchema.optional(),
      after_callback_redirect_url: urlSchema.optional(),
      stack_response_mode: yupString().oneOf(["json", "redirect"]).default("redirect"),
      ...botChallengeFlowRequestSchemaFields,

      // oauth parameters
      client_id: yupString().defined(),
      client_secret: yupString().defined(),
      redirect_uri: urlSchema.defined(),
      scope: yupString().defined(),
      state: yupString().defined(),
      grant_type: yupString().oneOf(["authorization_code"]).defined(),
      code_challenge: yupString().defined(),
      code_challenge_method: yupString().defined(),
      response_type: yupString().defined(),
    }).noUnknown(/* Allow unknown query params such as ttclid, other stuff that's being injected by browsers */ false).defined(),
  }),
  response: yupUnion(
    yupObject({
      // The SDK uses stack_response_mode=json so it can intercept bot challenges before navigating.
      // The redirect path (default) is the legacy browser-direct flow.
      statusCode: yupNumber().oneOf([200]).defined(),
      bodyType: yupString().oneOf(["json"]).defined(),
      body: yupObject({
        location: yupString().defined(),
      }).defined(),
    }).defined(),
    yupObject({
      statusCode: yupNumber().oneOf([307]).defined(),
      headers: yupObject({
        location: yupArray(yupString().defined()).defined(),
      }).defined(),
      bodyType: yupString().oneOf(["text"]).defined(),
      body: yupString().defined(),
    }).defined(),
  ) as unknown as Schema<SmartResponse>,
  async handler({ params, query }, fullReq) {
    const tenancy = await getSoleTenancyFromProjectBranch(...getProjectBranchFromClientId(query.client_id), true);
    if (!tenancy) {
      throw new KnownErrors.InvalidOAuthClientIdOrSecret(query.client_id);
    }

    const keyCheck = await checkApiKeySet(tenancy.project.id, { publishableClientKey: query.client_secret });
    if (keyCheck.status === "error") {
      throwCheckApiKeySetError(keyCheck.error, tenancy.project.id, new KnownErrors.InvalidPublishableClientKey(tenancy.project.id));
    }

    const providerRaw = Object.entries(tenancy.config.auth.oauth.providers).find(([providerId, _]) => providerId === params.provider_id);
    if (!providerRaw) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    const provider = { id: providerRaw[0], ...providerRaw[1] };

    if (query.type === "link" && !query.token) {
      throw new StatusError(StatusError.BadRequest, "?token= query parameter is required for link type");
    }
    if (
      query.after_callback_redirect_url
      && !validateRedirectUrl(query.after_callback_redirect_url, tenancy)
      && !isAcceptedNativeAppUrl(query.after_callback_redirect_url)
    ) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }

    const { turnstileAssessment } = await getRequestContextAndBotChallengeAssessment(query, "oauth_authenticate", tenancy);

    if (query.provider_scope && provider.isShared) {
      throw new KnownErrors.OAuthExtraScopeNotAvailableWithSharedOAuthKeys();
    }

    // If a token is provided, store it in the outer info so we can use it to link another user to the account, or to upgrade an anonymous user
    let projectUserId: string | undefined;
    if (query.token) {
      const result = await decodeAccessToken(query.token, { allowAnonymous: true, allowRestricted: true });
      if (result.status === "error") {
        throw result.error;
      }
      const { userId, projectId: accessTokenProjectId, branchId: accessTokenBranchId } = result.data;

      if (accessTokenProjectId !== tenancy.project.id) {
        throw new StatusError(StatusError.Forbidden, "The access token is not valid for this project");
      }
      if (accessTokenBranchId !== tenancy.branchId) {
        throw new StatusError(StatusError.Forbidden, "The access token is not valid for this branch");
      }

      projectUserId = userId;
    }

    const innerCodeVerifier = generators.codeVerifier();
    const innerState = generators.state();
    const providerObj = await getProvider(provider);
    const oauthUrl = providerObj.getAuthorizationUrl({
      codeVerifier: innerCodeVerifier,
      state: innerState,
      extraScope: query.provider_scope,
    });

    await globalPrismaClient.oAuthOuterInfo.create({
      data: {
        innerState,
        info: {
          tenancyId: tenancy.id,
          publishableClientKey: query.client_secret,
          redirectUri: query.redirect_uri.split('#')[0], // remove hash
          scope: query.scope,
          state: query.state,
          grantType: query.grant_type,
          codeChallenge: query.code_challenge,
          codeChallengeMethod: query.code_challenge_method,
          responseType: query.response_type,
          innerCodeVerifier: innerCodeVerifier,
          type: query.type,
          projectUserId: projectUserId,
          providerScope: query.provider_scope,
          errorRedirectUrl: query.error_redirect_uri || query.error_redirect_url,
          afterCallbackRedirectUrl: query.after_callback_redirect_url,
          turnstileResult: turnstileAssessment.status,
          turnstileVisibleChallengeResult: turnstileAssessment.visibleChallengeResult,
          responseMode: query.stack_response_mode,
        } satisfies InferType<typeof oauthCookieSchema>,
        expiresAt: new Date(Date.now() + 1000 * 60 * outerOAuthFlowExpirationInMinutes),
      },
    });

    if (query.stack_response_mode === "json") {
      // In JSON mode the client controls the flow programmatically and PKCE
      // already prevents CSRF, so we skip the cookie (which would require
      // credentials: "include" and a non-wildcard CORS origin).
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          location: oauthUrl,
        },
      };
    }

    // For browser-redirect mode, set a CSRF cookie that the callback route checks.
    (await cookies()).set(
      "stack-oauth-inner-" + innerState,
      "true",
      {
        httpOnly: true,
        secure: getNodeEnvironment() !== "development",
        maxAge: 60 * outerOAuthFlowExpirationInMinutes,
      }
    );

    redirect(oauthUrl);
  },
});
