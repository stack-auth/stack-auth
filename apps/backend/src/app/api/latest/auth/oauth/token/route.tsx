import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getProjectBranchFromClientId, oauthServer } from "@/oauth";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { InvalidClientError, InvalidGrantError, InvalidRequestError, Request as OAuthRequest, Response as OAuthResponse, ServerError } from "@node-oauth/oauth2-server";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { oauthResponseToSmartResponse } from "../oauth-helpers";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "OAuth token endpoints",
    description: "This endpoint is used to exchange an authorization code or refresh token for an access token.",
    tags: ["Oauth"]
  },
  request: yupObject({
    body: yupObject({
      grant_type: yupString().oneOf(["authorization_code", "refresh_token"]).defined(),
      client_id: yupString().optional(),
      client_secret: yupString().optional(),
    }).unknown().defined(),
  }).defined(),
  response: yupObject({
    statusCode: yupNumber().defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
    headers: yupMixed().defined(),
  }),
  async handler(req, fullReq) {
    const publicOAuthClientSecretSentinel = "__stack_public_client__";
    const clientId = req.body.client_id;
    const clientSecretRaw = req.body.client_secret;
    const clientSecret = !clientSecretRaw || clientSecretRaw === publicOAuthClientSecretSentinel
      ? undefined
      : clientSecretRaw;
    if (clientId && !clientSecret) {
      const [projectId, branchId] = getProjectBranchFromClientId(clientId);
      const tenancy = await getSoleTenancyFromProjectBranch(projectId, branchId, true);
      if (tenancy?.config.project.requirePublishableClientKey) {
        throw new KnownErrors.PublishableClientKeyRequiredForProject(tenancy.project.id);
      }
      req.body.client_secret = publicOAuthClientSecretSentinel;
    }

    const oauthRequest = new OAuthRequest({
      headers: {
        ...fullReq.headers,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: fullReq.method,
      body: fullReq.body,
      query: fullReq.query,
    });


    const oauthResponse = new OAuthResponse();
    try {
      await oauthServer.token(
        oauthRequest,
        oauthResponse,
        {
          // note the `accessTokenLifetime` won't have any effect here because we set it in the `generateAccessTokenFromRefreshTokenIfValid` function
          refreshTokenLifetime: 60 * 60 * 24 * 365, // 1 year
          alwaysIssueNewRefreshToken: false, // add token rotation later
        }
      );
    } catch (e) {
      if (e instanceof InvalidGrantError) {
        switch (req.body.grant_type) {
          case "authorization_code": {
            throw new KnownErrors.InvalidAuthorizationCode();
          }
          case "refresh_token": {
            throw new KnownErrors.RefreshTokenNotFoundOrExpired();
          }
        }
      }
      if (e instanceof InvalidClientError) {
        throw new KnownErrors.InvalidOAuthClientIdOrSecret();
      }
      if (e instanceof InvalidRequestError) {
        if (e.message.includes("`redirect_uri` is invalid")) {
          throw new StatusError(400, "Invalid redirect URI. Your redirect URI must be the same as the one used to get the authorization code.");
        } else if (oauthResponse.status && oauthResponse.status >= 400 && oauthResponse.status < 500) {
          console.log("Invalid OAuth token request by a client; returning it to the user", e);
          return oauthResponseToSmartResponse(oauthResponse);
        } else {
          throw e;
        }
      }
      if (e instanceof ServerError) {
        throw (e as any).inner ?? e;
      }
      throw e;
    }

    return oauthResponseToSmartResponse(oauthResponse);
  },
});
