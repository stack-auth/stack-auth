/**
 * SAML Assertion Consumer Service. Mirrors /auth/oauth/callback/[provider_id]:
 * receives the IdP's POST, verifies the assertion, runs the SAML user-linking
 * flow, then hands off to oauthServer.authorize so Stack Auth issues a
 * customer-facing OAuth code (Stack Auth itself acts as an OAuth2 provider
 * to the customer's SDK — see comment at top of oauth/callback/[provider_id]
 * for context).
 *
 * Replay protection: the matching SamlOuterInfo row is consumed
 * (deleted) at the end of a successful flow, and the route looks up by
 * InResponseTo before calling node-saml's full validation. node-saml then
 * also enforces signature, audience, NotBefore/NotOnOrAfter, and
 * InResponseTo equality.
 */
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getBestEffortEndUserRequestContext } from "@/lib/end-users";
import { reconstructTurnstileAssessment, buildSignUpRuleOptions } from "@/lib/sign-up-context";
import { checkApiKeySet, throwCheckApiKeySetError } from "@/lib/internal-api-keys";
import { isAcceptedNativeAppUrl, validateRedirectUrl } from "@/lib/redirect-urls";
import { createSamlUserAndAccount, findExistingSamlAccount, handleSamlEmailMergeStrategy, linkSamlAccountToUser } from "@/lib/saml-account";
import { Tenancy, getTenancy } from "@/lib/tenancies";
import { oauthServer } from "@/oauth";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { buildSamlClient, extractInResponseTo, parseAndVerifyAssertion, SamlConnectionConfig } from "@/saml/saml";
import { InvalidClientError, InvalidScopeError, Request as OAuthRequest, Response as OAuthResponse } from "@node-oauth/oauth2-server";
import { KnownError, KnownErrors } from "@stackframe/stack-shared";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { oauthResponseToSmartResponse } from "../../../oauth/oauth-helpers";

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

const redirectOrThrowError = (error: KnownError, tenancy: Tenancy, options: {
  callbackRedirectUrl?: string,
  errorRedirectUrl?: string,
}) => {
  const target =
    options.callbackRedirectUrl && (validateRedirectUrl(options.callbackRedirectUrl, tenancy) || isAcceptedNativeAppUrl(options.callbackRedirectUrl))
      ? options.callbackRedirectUrl
      : options.errorRedirectUrl && (validateRedirectUrl(options.errorRedirectUrl, tenancy) || isAcceptedNativeAppUrl(options.errorRedirectUrl))
        ? options.errorRedirectUrl
        : null;
  if (!target) throw error;

  const url = new URL(target);
  url.searchParams.set("error", "server_error");
  url.searchParams.set("error_description", error.message);
  url.searchParams.set("errorCode", error.errorCode);
  url.searchParams.set("message", error.message);
  url.searchParams.set("details", error.details ? JSON.stringify(error.details) : JSON.stringify({}));
  redirect(url.toString());
};

const shouldRedirectKnownError = (error: KnownError) => (
  KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse.isInstance(error)
  || KnownErrors.SignUpNotEnabled.isInstance(error)
  || KnownErrors.SignUpRejected.isInstance(error)
);

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    params: yupObject({
      connection_id: yupString().defined(),
    }).defined(),
    body: yupMixed().defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([303, 307]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
    headers: yupMixed().defined(),
  }),
  async handler({ params, body }) {
    const samlResponseB64 = (body as Record<string, unknown>).SAMLResponse as string | undefined;
    if (!samlResponseB64) {
      throw new StatusError(StatusError.BadRequest, "Missing SAMLResponse in form body");
    }

    const inResponseTo = extractInResponseTo(samlResponseB64);
    if (!inResponseTo) {
      throw new StatusError(StatusError.BadRequest, "SAMLResponse has no InResponseTo (IdP-initiated SSO is not supported in V1)");
    }

    const outerInfoDB = await globalPrismaClient.samlOuterInfo.findUnique({ where: { id: inResponseTo } });
    if (!outerInfoDB) {
      throw new StatusError(StatusError.BadRequest, "Unknown InResponseTo — SAMLResponse does not match any pending AuthnRequest. Please try signing in again.");
    }

    const outerInfo = outerInfoDB.info as unknown as SamlOuterInfoPayload;

    if (outerInfo.samlConnectionId !== params.connection_id) {
      // Cross-connection forgery — assertion was sent to the wrong ACS endpoint.
      throw new StatusError(StatusError.BadRequest, "SAML connection mismatch (assertion sent to wrong ACS endpoint)");
    }

    if (outerInfoDB.expiresAt < new Date()) {
      throw new KnownErrors.OuterOAuthTimeout();
    }

    if (outerInfo.responseMode !== "json") {
      const cookieInfo = (await cookies()).get("stack-saml-inner-" + inResponseTo);
      (await cookies()).delete("stack-saml-inner-" + inResponseTo);
      if (cookieInfo?.value !== "true") {
        throw new StatusError(StatusError.BadRequest, "Inner SAML cookie not found. Likely the page was refreshed mid-flow. Please try signing in again.");
      }
    }

    const tenancy = await getTenancy(outerInfo.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("Tenancy from SamlOuterInfo not found", { tenancyId: outerInfo.tenancyId });
    }
    const prisma = await getPrismaClientForTenancy(tenancy);

    if (!tenancy.config.apps.installed["saml-sso"]?.enabled) {
      throw new KnownErrors.SamlSsoNotEnabled();
    }

    if (!(params.connection_id in tenancy.config.auth.saml.connections)) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} not found`);
    }
    const connectionRaw = tenancy.config.auth.saml.connections[params.connection_id];
    if (!connectionRaw.idpEntityId || !connectionRaw.idpSsoUrl || !connectionRaw.idpCertificate) {
      throw new StatusError(StatusError.NotFound, `SAML connection ${params.connection_id} is incompletely configured`);
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

    const keyCheck = await checkApiKeySet(tenancy.project.id, { publishableClientKey: outerInfo.publishableClientKey });
    if (keyCheck.status === "error") {
      throwCheckApiKeySetError(keyCheck.error, tenancy.project.id, new KnownErrors.InvalidPublishableClientKey(tenancy.project.id));
    }

    try {
      const baseUrl = new URL(outerInfo.redirectUri).origin;
      const client = buildSamlClient(connection, baseUrl);
      const assertion = await parseAndVerifyAssertion(client, connection, samlResponseB64, undefined);

      // Defense-in-depth: node-saml's validation already checks InResponseTo,
      // but we re-check here against what we stored.
      if (assertion.inResponseTo !== inResponseTo) {
        throw new StatusError(StatusError.BadRequest, "Assertion InResponseTo does not match the AuthnRequest ID we stored");
      }
      if (!assertion.nameId) {
        throw new StatusError(StatusError.BadRequest, "Assertion has no NameID");
      }
      if (!assertion.email) {
        throw new StatusError(StatusError.BadRequest, "Assertion has no email attribute or email-format NameID");
      }

      // Reconstruct the OAuth context originally passed to /auth/saml/login —
      // oauthServer.authorize needs all of it to issue the customer-facing code.
      const oauthRequest = new OAuthRequest({
        headers: {},
        body: {},
        method: "GET",
        query: {
          client_id: `${tenancy.project.id}#${tenancy.branchId}`,
          client_secret: outerInfo.publishableClientKey,
          redirect_uri: outerInfo.redirectUri,
          state: outerInfo.state,
          scope: outerInfo.scope,
          grant_type: outerInfo.grantType,
          code_challenge: outerInfo.codeChallenge,
          code_challenge_method: outerInfo.codeChallengeMethod,
          response_type: outerInfo.responseType,
        },
      });

      const oauthResponse = new OAuthResponse();
      try {
        await oauthServer.authorize(
          oauthRequest,
          oauthResponse,
          {
            authenticateHandler: {
              handle: async () => {
                try {
                  const existing = await findExistingSamlAccount(
                    prisma,
                    outerInfo.tenancyId,
                    params.connection_id,
                    assertion.nameId,
                  );
                  if (existing) {
                    return {
                      id: existing.projectUserId ?? throwAssertion("SAML account exists but has no associated user"),
                      newUser: false,
                      afterCallbackRedirectUrl: outerInfo.afterCallbackRedirectUrl,
                    };
                  }

                  // No existing SAML account → try to merge with an existing
                  // user by email, otherwise create a new user.
                  const { linkedUserId, primaryEmailAuthEnabled } = await handleSamlEmailMergeStrategy(
                    prisma,
                    tenancy,
                    { email: assertion.email!, emailVerified: true },
                  );

                  if (linkedUserId) {
                    await linkSamlAccountToUser(prisma, {
                      tenancyId: outerInfo.tenancyId,
                      samlConnectionId: params.connection_id,
                      nameId: assertion.nameId,
                      nameIdFormat: assertion.nameIdFormat,
                      email: assertion.email,
                      projectUserId: linkedUserId,
                    });
                    return {
                      id: linkedUserId,
                      newUser: false,
                      afterCallbackRedirectUrl: outerInfo.afterCallbackRedirectUrl,
                    };
                  }

                  const requestContext = await getBestEffortEndUserRequestContext();
                  const { projectUserId: newUserId } = await createSamlUserAndAccount(
                    prisma,
                    tenancy,
                    {
                      samlConnectionId: params.connection_id,
                      nameId: assertion.nameId,
                      nameIdFormat: assertion.nameIdFormat,
                      email: assertion.email,
                      emailVerified: true, // SAML assertions are signed by the IdP — treat email as verified
                      primaryEmailAuthEnabled,
                      currentUser: null,
                      displayName: assertion.displayName,
                      profileImageUrl: null,
                      signUpRuleOptions: buildSignUpRuleOptions({
                        authMethod: "oauth", // closest existing tag; future: add 'saml'
                        oauthProvider: `saml:${params.connection_id}`,
                        requestContext,
                        turnstileAssessment: reconstructTurnstileAssessment("invalid", undefined),
                      }),
                    },
                  );

                  return {
                    id: newUserId,
                    newUser: true,
                    afterCallbackRedirectUrl: outerInfo.afterCallbackRedirectUrl,
                  };
                } catch (error) {
                  if (KnownError.isKnownError(error) && shouldRedirectKnownError(error)) {
                    redirectOrThrowError(error, tenancy, {
                      callbackRedirectUrl: outerInfo.redirectUri,
                      errorRedirectUrl: outerInfo.errorRedirectUrl,
                    });
                  }
                  throw error;
                }
              },
            },
          },
        );
      } catch (error) {
        if (error instanceof InvalidClientError) {
          if (error.message.includes("redirect_uri") || error.message.includes("redirectUri")) {
            throw new KnownErrors.RedirectUrlNotWhitelisted();
          }
        } else if (error instanceof InvalidScopeError) {
          captureError("saml-acs-invalid-scope", new StackAssertionError(deindent`
            Client requested an invalid scope during SAML ACS.
              Scopes requested: ${oauthRequest.query?.scope}
          `, { outerInfo, cause: error, scopes: oauthRequest.query?.scope }));
          throw new StatusError(StatusError.BadRequest, "Invalid scope requested");
        }
        throw error;
      }

      // Replay protection — consume the OuterInfo row so the same assertion
      // (or a re-issued one from the same AuthnRequest) cannot be replayed.
      // The next look-up by InResponseTo will 400.
      await globalPrismaClient.samlOuterInfo.delete({ where: { id: inResponseTo } });

      return oauthResponseToSmartResponse(oauthResponse);
    } catch (error) {
      if (KnownError.isKnownError(error)) {
        redirectOrThrowError(error, tenancy, {
          callbackRedirectUrl: outerInfo.redirectUri,
          errorRedirectUrl: outerInfo.errorRedirectUrl,
        });
      }
      throw error;
    }
  },
});

function throwAssertion(msg: string): never {
  throw new StackAssertionError(msg);
}
