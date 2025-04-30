import { checkApiKeySet } from "@/lib/internal-api-keys";
import { getSoleTenancyFromProject } from "@/lib/tenancies";
import { decodeAccessToken, oauthCookieSchema } from "@/lib/tokens";
import { getProvider } from "@/oauth";
import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { urlSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { generators } from "openid-client";
import * as yup from "yup";

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
      after_callback_redirect_url: yupString().optional(),

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
    }).defined(),
  }),
  response: yupObject({
    // we never return as we always redirect
    statusCode: yupNumber().oneOf([302]).defined(),
    bodyType: yupString().oneOf(["empty"]).defined(),
  }),
  async handler({ params, query }, fullReq) {
    const tenancy = await getSoleTenancyFromProject(query.client_id, true);

    if (!tenancy) {
      throw new KnownErrors.InvalidOAuthClientIdOrSecret(query.client_id);
    }

    if (!(await checkApiKeySet(query.client_id, { publishableClientKey: query.client_secret }))) {
      throw new KnownErrors.InvalidPublishableClientKey(query.client_id);
    }

    const provider = tenancy.config.oauth_providers.find((p) => p.id === params.provider_id);
    if (!provider) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    // If the authorization token is present, we are adding new scopes to the user instead of sign-in/sign-up
    let projectUserId: string | undefined;
    if (query.type === "link") {
      const result = await decodeAccessToken(query.token);
      if (result.status === "error") {
        throw result.error;
      }
      const { userId, projectId: accessTokenProjectId, branchId: accessTokenBranchId } = result.data;

      if (accessTokenProjectId !== query.client_id) {
        throw new StatusError(StatusError.Forbidden, "The access token is not valid for this project");
      }
      if (accessTokenBranchId !== tenancy.branchId) {
        throw new StatusError(StatusError.Forbidden, "The access token is not valid for this branch");
      }

      if (query.provider_scope && provider.type === "shared") {
        throw new KnownErrors.OAuthExtraScopeNotAvailableWithSharedOAuthKeys();
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

    await prismaClient.oAuthOuterInfo.create({
      data: {
        innerState,
        info: {
          tenancyId: tenancy.id,
          publishableClientKey: query.client_id,
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
        } satisfies yup.InferType<typeof oauthCookieSchema>,
        expiresAt: new Date(Date.now() + 1000 * 60 * outerOAuthFlowExpirationInMinutes),
      },
    });

    // prevent CSRF by keeping track of the inner state in cookies
    // the callback route must ensure that the inner state cookie is set
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
