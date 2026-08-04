// @vitest-environment jsdom

import { KnownErrors } from "@hexclave/shared";
import { AccessToken } from "@hexclave/shared/dist/sessions";
import { HexclaveSetupError } from "@hexclave/shared/dist/utils/errors";
import { afterEach, describe, expect, it } from "vitest";
import { SETUP_ERROR_OVERLAY_GLOBAL_INSTANCE_KEY } from "../../../../setup-error-overlay";
import { StackClientApp } from "../interfaces/client-app";

function createAccessTokenString(refreshTokenId: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      sub: "user-id",
      exp: nowSeconds + 60,
      iat: nowSeconds,
      iss: "https://api.example.test",
      aud: "project-id",
      project_id: "project-id",
      branch_id: "main",
      refresh_token_id: refreshTokenId,
      role: "authenticated",
      name: null,
      email: null,
      email_verified: false,
      selected_team_id: null,
      signed_up_at: nowSeconds,
      is_anonymous: false,
      is_restricted: false,
      restricted_reason: null,
      requires_totp_mfa: false,
    }),
    "",
  ].join(".");
}

function overlayRoots(): NodeListOf<Element> {
  return document.querySelectorAll(".hexclave-setup-error-overlay");
}

function createAppWithFailingHandoff(options: {
  projectId: string,
  sendClientRequest: () => Promise<never>,
}): StackClientApp<true> {
  const app = new StackClientApp({
    baseUrl: "http://localhost:12345",
    projectId: options.projectId,
    publishableClientKey: "stack-pk-test",
    tokenStore: "memory",
    redirectMethod: "none",
    noAutomaticPrefetch: true,
    devTool: false,
  });
  const accessToken = createAccessTokenString("source-refresh-token-id");
  const clientInterface = Reflect.get(app, "_interface");
  Reflect.set(clientInterface, "fetchNewAccessToken", async () => {
    return AccessToken.createIfValid(accessToken) ?? (() => {
      throw new Error("Expected the test access token to be valid.");
    })();
  });
  Reflect.set(clientInterface, "sendClientRequest", options.sendClientRequest);
  return app;
}

function createCrossDomainAuthRedirectUrl(app: StackClientApp<true>, redirectUri: string): Promise<unknown> {
  const method = Reflect.get(app, "_createCrossDomainAuthRedirectUrl");
  if (typeof method !== "function") {
    throw new Error("Expected StackClientApp to expose _createCrossDomainAuthRedirectUrl in tests.");
  }
  return method.call(app, {
    redirectUri,
    state: "handoff-state",
    codeChallenge: "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789-._~",
    afterCallbackRedirectUrl: redirectUri,
    overrideTokenStoreInit: {
      accessToken: createAccessTokenString("source-refresh-token-id"),
      refreshToken: "source-refresh-token",
    },
  });
}

describe("cross-domain handoff rejected by the server", () => {
  afterEach(() => {
    for (const root of overlayRoots()) {
      root.remove();
    }
    Reflect.deleteProperty(window, SETUP_ERROR_OVERLAY_GLOBAL_INSTANCE_KEY);
  });

  it("shows a setup error card even when the caller swallows the redirect failure", async () => {
    const untrustedUrl = "https://demo.example.test/?hexclave_cross_domain_auth=1";
    const app = createAppWithFailingHandoff({
      projectId: "00000000-0000-4000-8000-000000000101",
      sendClientRequest: async () => {
        throw new KnownErrors.RedirectUrlNotWhitelisted(untrustedUrl);
      },
    });

    // The hosted auth pages catch a failing post-auth redirect and render their own "we could not continue
    // automatically, please try again" screen, which is exactly how this error used to disappear: nothing on the page
    // said that the flow is dead until a domain is added to the project's trusted domains.
    let caught: unknown = null;
    try {
      await createCrossDomainAuthRedirectUrl(app, untrustedUrl);
    } catch (error) {
      caught = error;
    }

    expect(HexclaveSetupError.isSetupError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(Error);
    // The handoff query parameters have nothing to do with the rejection, so the message keeps only the checked part.
    expect((caught as Error).message).toBe("Cross-domain auth redirect URL https://demo.example.test/ is not trusted.");
    // The full URL is still handed to the error sinks, which is where `customCaptureExtraArgs` ends up.
    expect(Reflect.get(caught as object, "customCaptureExtraArgs")).toMatchObject([{ url: untrustedUrl }]);
    expect((caught as Error).cause).toBeInstanceOf(KnownErrors.RedirectUrlNotWhitelisted);

    expect(overlayRoots()).toHaveLength(1);
    const cardText = document.body.textContent;
    expect(cardText).toContain("A domain in your authentication flow is not one of your project's trusted domains");
    expect(cardText).toContain("add it to your project's trusted domains in the Hexclave dashboard, under Domains.");
  });

  it("leaves other handoff failures to captureError", async () => {
    const app = createAppWithFailingHandoff({
      projectId: "00000000-0000-4000-8000-000000000102",
      sendClientRequest: async () => {
        throw new KnownErrors.UserAuthenticationRequired();
      },
    });

    await expect(createCrossDomainAuthRedirectUrl(app, "https://demo.example.test/")).rejects.toSatisfy(
      (error: unknown) => KnownErrors.UserAuthenticationRequired.isInstance(error),
    );
    expect(overlayRoots()).toHaveLength(0);
  });
});
