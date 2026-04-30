/**
 * SAML SP-initiated login. Mirrors /auth/oauth/authorize/[provider_id]:
 * receives the same OAuth client params (so Stack Auth itself can later
 * issue an OAuth code via oauthServer.authorize), stashes them in
 * SamlOuterInfo keyed by AuthnRequest ID, and redirects to the IdP.
 *
 * V1 scope: SP-initiated only, no signed AuthnRequests, no link/upgrade
 * flow (just plain sign-in). Turnstile is also skipped here — SAML
 * sign-in originates from a corporate IdP, not a public form.
 */
import { checkApiKeySet, throwCheckApiKeySetError } from "@/lib/internal-api-keys";
import { isAcceptedNativeAppUrl, validateRedirectUrl } from "@/lib/redirect-urls";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getProjectBranchFromClientId } from "@/oauth";
import { globalPrismaClient } from "@/prisma-client";
import type { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { buildAuthnRequestUrl, buildSamlClient, SamlConnectionConfig } from "@/saml/saml";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { urlSchema, yupArray, yupNumber, yupObject, yupString, yupUnion } from "@stackframe/stack-shared/dist/schema-fields";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Schema } from "yup";

const SAML_OUTER_TTL_MINUTES = 10;

// Stored in SamlOuterInfo.info — narrower than OAuth's outer info because
// SAML doesn't have PKCE / response_type / scope handling at this layer.
type SamlOuterInfoPayload = {
  tenancyId: string,
  samlConnectionId: string,
  publishableClientKey: string,
  redirectUri: string,
  state: string,
  scope: string,
  grantType: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  responseType: string,
  errorRedirectUrl?: string,
  afterCallbackRedirectUrl?: string,
  responseMode: "json" | "redirect",
};

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "SAML SP-initiated login",
    description: "Build a SAML AuthnRequest, persist outer state, and redirect the browser to the IdP.",
    tags: ["Saml"],
  },
  request: yupObject({
    params: yupObject({
      connection_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      // Stack Auth OAuth client params — same as /auth/oauth/authorize.
      client_id: yupString().defined(),
      client_secret: yupString().defined(),
      redirect_uri: urlSchema.defined(),
      scope: yupString().defined(),
      state: yupString().defined(),
      grant_type: yupString().oneOf(["authorization_code"]).defined(),
      code_challenge: yupString().defined(),
      code_challenge_method: yupString().defined(),
      response_type: yupString().defined(),
      // Optional after-callback redirect (where to send the user post-sign-in).
      after_callback_redirect_url: urlSchema.optional(),
      error_redirect_uri: urlSchema.optional(),
      // SDK uses stack_response_mode=json so it can intercept before navigating.
      stack_response_mode: yupString().oneOf(["json", "redirect"]).default("redirect"),
    }).noUnknown(false).defined(),
  }),
  response: yupUnion(
    yupObject({
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

    if (!tenancy.config.apps.installed["saml-sso"]?.enabled) {
      throw new KnownErrors.SamlSsoNotEnabled();
    }

    if (!(params.connection_id in tenancy.config.auth.saml.connections)) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} not found`);
    }
    const connectionRaw = tenancy.config.auth.saml.connections[params.connection_id];
    if (connectionRaw.allowSignIn === false) {
      throw new StatusError(StatusError.Forbidden, `SAML connection ${params.connection_id} has sign-in disabled`);
    }
    if (!connectionRaw.idpEntityId || !connectionRaw.idpSsoUrl || !connectionRaw.idpCertificate) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} is incompletely configured`);
    }

    if (
      query.after_callback_redirect_url
      && !validateRedirectUrl(query.after_callback_redirect_url, tenancy)
      && !isAcceptedNativeAppUrl(query.after_callback_redirect_url)
    ) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }

    const connection: SamlConnectionConfig = {
      id: params.connection_id,
      displayName: connectionRaw.displayName,
      idpEntityId: connectionRaw.idpEntityId,
      idpSsoUrl: connectionRaw.idpSsoUrl,
      idpCertificate: connectionRaw.idpCertificate,
      domain: connectionRaw.domain,
      attributeMapping: connectionRaw.attributeMapping,
    };

    // SP base URL must be the backend's own origin — that's where the ACS
    // route lives. Using the customer's redirect_uri origin would cause the
    // IdP to POST the assertion to the customer app (404). Same source as
    // the metadata route uses, keeping login + metadata consistent.
    const reqUrl = new URL(fullReq.url);
    const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const client = buildSamlClient(connection, baseUrl);
    const { url: samlUrl, requestId } = await buildAuthnRequestUrl(client, query.state);

    const payload: SamlOuterInfoPayload = {
      tenancyId: tenancy.id,
      samlConnectionId: params.connection_id,
      publishableClientKey: query.client_secret,
      redirectUri: query.redirect_uri.split("#")[0],
      state: query.state,
      scope: query.scope,
      grantType: query.grant_type,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      responseType: query.response_type,
      errorRedirectUrl: query.error_redirect_uri,
      afterCallbackRedirectUrl: query.after_callback_redirect_url,
      responseMode: query.stack_response_mode,
    };

    await globalPrismaClient.samlOuterInfo.create({
      data: {
        id: requestId,
        info: payload as unknown as object,
        expiresAt: new Date(Date.now() + 1000 * 60 * SAML_OUTER_TTL_MINUTES),
      },
    });

    if (query.stack_response_mode === "json") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { location: samlUrl },
      };
    }

    // Browser-redirect mode: set a CSRF cookie keyed to the AuthnRequest ID.
    // The ACS route checks this cookie before honoring the assertion.
    (await cookies()).set(
      "stack-saml-inner-" + requestId,
      "true",
      {
        httpOnly: true,
        secure: getNodeEnvironment() !== "development",
        maxAge: 60 * SAML_OUTER_TTL_MINUTES,
      },
    );

    redirect(samlUrl);
  },
});
