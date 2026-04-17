import { checkApiKeySet, throwCheckApiKeySetError } from "@/lib/internal-api-keys";
import { isAcceptedNativeAppUrl, validateRedirectUrl } from "@/lib/redirect-urls";
import { Tenancy } from "@/lib/tenancies";
import { isRefreshTokenValid } from "@/lib/tokens";
import { oauthServer } from "@/oauth";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, urlSchema, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { publishableClientKeyNotNecessarySentinel } from "@stackframe/stack-shared/dist/utils/oauth";
import { InvalidClientError, InvalidScopeError, Request as OAuthRequest, Response as OAuthResponse } from "@node-oauth/oauth2-server";

type CrossDomainAuthorizeBody = {
  redirect_uri: string,
  state: string,
  code_challenge: string,
  code_challenge_method: "S256",
  after_callback_redirect_url?: string,
};

export async function createCrossDomainAuthorizeRedirect(options: {
  tenancy: Tenancy,
  user: { id: string, refreshTokenId: string } | null,
  publishableClientKey: string,
  body: CrossDomainAuthorizeBody,
}): Promise<string> {
  const { tenancy, user, body } = options;
  if (!user) {
    throw new KnownErrors.UserAuthenticationRequired();
  }
  if (
    !validateRedirectUrl(body.redirect_uri, tenancy) &&
    !isAcceptedNativeAppUrl(body.redirect_uri)
  ) {
    throw new KnownErrors.RedirectUrlNotWhitelisted();
  }
  if (
    body.after_callback_redirect_url &&
    !validateRedirectUrl(body.after_callback_redirect_url, tenancy) &&
    !isAcceptedNativeAppUrl(body.after_callback_redirect_url)
  ) {
    throw new KnownErrors.RedirectUrlNotWhitelisted();
  }
  const oauthRequest = new OAuthRequest({
    headers: {},
    body: {},
    method: "GET",
    query: {
      client_id: tenancy.branchId === "main" ? tenancy.project.id : `${tenancy.project.id}#${tenancy.branchId}`,
      client_secret: options.publishableClientKey,
      redirect_uri: body.redirect_uri,
      scope: "legacy",
      state: body.state,
      grant_type: "authorization_code",
      code_challenge: body.code_challenge,
      code_challenge_method: body.code_challenge_method,
      response_type: "code",
    },
  });
  const oauthResponse = new OAuthResponse();
  try {
    await oauthServer.authorize(
      oauthRequest,
      oauthResponse,
      {
        authenticateHandler: {
          handle: async () => ({
            id: user.id,
            refreshTokenId: user.refreshTokenId,
            newUser: false,
            afterCallbackRedirectUrl: body.after_callback_redirect_url,
          }),
        },
      },
    );
  } catch (error) {
    if (error instanceof InvalidClientError) {
      throw new KnownErrors.InvalidOAuthClientIdOrSecret();
    }
    if (error instanceof InvalidScopeError) {
      throw new StatusError(400, "Invalid scope requested.");
    }
    throw error;
  }

  const redirectUrl = oauthResponse.headers?.location;
  if (typeof redirectUrl !== "string") {
    throw new StackAssertionError("Cross-domain authorization response is missing redirect location", {
      oauthResponse,
    });
  }
  return redirectUrl;
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create cross-domain auth handoff redirect",
    description: "Creates a one-time OAuth authorization code redirect for cross-domain sign-in handoff using PKCE.",
    tags: ["Oauth"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
      refreshTokenId: adaptSchema.optional(),
    }).defined(),
    headers: yupObject({
      "x-stack-publishable-client-key": yupTuple([yupString().defined()]).optional(),
      "x-stack-refresh-token": yupTuple([yupString().defined()]).optional(),
    }).defined(),
    body: yupObject({
      redirect_uri: urlSchema.defined(),
      state: yupString().min(1).max(512).defined(),
      code_challenge: yupString().matches(/^[A-Za-z0-9._~-]{43,128}$/).defined(),
      code_challenge_method: yupString().oneOf(["S256"]).default("S256"),
      after_callback_redirect_url: urlSchema.optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      redirect_url: urlSchema.defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy, user, refreshTokenId }, headers, body }) {
    let userWithSession: { id: string, refreshTokenId: string } | null = null;
    if (!user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (!refreshTokenId) {
      throw new StatusError(400, "Cross-domain auth handoff requires a refresh-token-bound session. Please sign in again.");
    }
    const providedRefreshToken = headers["x-stack-refresh-token"]?.[0];
    if (!providedRefreshToken) {
      throw new StatusError(400, "Cross-domain auth handoff requires passing the current refresh token.");
    }
    const refreshTokenObj = await globalPrismaClient.projectUserRefreshToken.findUnique({
      where: {
        refreshToken: providedRefreshToken,
      },
    });
    if (
      !refreshTokenObj
      || refreshTokenObj.id !== refreshTokenId
      || refreshTokenObj.projectUserId !== user.id
      || refreshTokenObj.tenancyId !== tenancy.id
    ) {
      throw new StatusError(401, "Cross-domain auth handoff refresh token does not match the authenticated session.");
    }
    if (!await isRefreshTokenValid({ tenancy, refreshTokenObj })) {
      throw new StatusError(401, "Cross-domain auth handoff refresh token is not valid.");
    }
    userWithSession = {
      id: user.id,
      refreshTokenId: refreshTokenObj.id,
    };
    const publishableClientKey = headers["x-stack-publishable-client-key"]?.[0] ?? publishableClientKeyNotNecessarySentinel;
    const keyCheck = await checkApiKeySet(tenancy.project.id, { publishableClientKey });
    if (keyCheck.status === "error") {
      throwCheckApiKeySetError(
        keyCheck.error,
        tenancy.project.id,
        new KnownErrors.InvalidPublishableClientKey(tenancy.project.id),
      );
    }
    const redirectUrl = await createCrossDomainAuthorizeRedirect({
      tenancy,
      user: userWithSession,
      publishableClientKey,
      body,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        redirect_url: redirectUrl,
      },
    };
  },
});
