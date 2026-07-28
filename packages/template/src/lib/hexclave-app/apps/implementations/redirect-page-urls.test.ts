import { describe, expect, it } from "vitest";
import { planRedirectToHandler } from "./redirect-page-urls";

const defaultAfterAuthUrl = "/";
const localOAuthCallbackUrl = "/handler/oauth-callback";
const afterAuthHandlers: readonly ("afterSignIn" | "afterSignUp")[] = [
  "afterSignIn",
  "afterSignUp",
];

async function planAfterAuthRedirect(
  handlerName: "afterSignIn" | "afterSignUp",
  currentUrl: string,
) {
  return await planRedirectToHandler({
    handlerName,
    rawHandlerUrl: defaultAfterAuthUrl,
    noRedirectBack: false,
    currentUrl: new URL(currentUrl),
    localOAuthCallbackUrl,
    getCrossDomainHandoffParams: async () => ({
      state: "state",
      codeChallenge: "code-challenge",
    }),
  });
}

describe("after-auth redirect planning", () => {
  it("falls back to the default when after_auth_return_to points to the current page", async () => {
    await expect(
      Promise.all(afterAuthHandlers.map((handlerName) => planAfterAuthRedirect(
        handlerName,
        "https://hosted.example.test/handler/sign-in?after_auth_return_to=%2Fhandler%2Fsign-in",
      ))),
    ).resolves.toMatchInlineSnapshot(`
      [
        {
          "type": "redirect",
          "url": "/",
        },
        {
          "type": "redirect",
          "url": "/",
        },
      ]
    `);
  });

  it("honors a different after_auth_return_to path", async () => {
    await expect(
      planAfterAuthRedirect(
        "afterSignIn",
        "https://hosted.example.test/handler/sign-in?after_auth_return_to=%2Fdashboard",
      ),
    ).resolves.toMatchInlineSnapshot(`
      {
        "type": "redirect",
        "url": "/dashboard",
      }
    `);
  });

  it("treats query and hash differences on the current path as self-referential", async () => {
    await expect(
      planAfterAuthRedirect(
        "afterSignUp",
        "https://hosted.example.test/handler/sign-in?after_auth_return_to=%2Fhandler%2Fsign-in%3Ftab%3Dpassword%23details",
      ),
    ).resolves.toMatchInlineSnapshot(`
      {
        "type": "redirect",
        "url": "/",
      }
    `);
  });

  it("preserves a cross-domain handoff when its same-origin target matches the current path", async () => {
    const currentUrl = new URL("https://hosted.example.test/handler/oauth-callback");
    const redirectBackTarget = new URL("https://hosted.example.test/handler/oauth-callback");
    redirectBackTarget.searchParams.set("hexclave_cross_domain_auth", "1");
    redirectBackTarget.searchParams.set("hexclave_cross_domain_state", "state");
    redirectBackTarget.searchParams.set("hexclave_cross_domain_code_challenge", "code-challenge");
    redirectBackTarget.searchParams.set(
      "hexclave_cross_domain_after_callback_redirect_url",
      "https://app.example.test/callback",
    );
    currentUrl.searchParams.set("after_auth_return_to", redirectBackTarget.pathname + redirectBackTarget.search);

    await expect(
      planRedirectToHandler({
        handlerName: "afterSignIn",
        rawHandlerUrl: defaultAfterAuthUrl,
        noRedirectBack: false,
        currentUrl,
        localOAuthCallbackUrl,
        getCrossDomainHandoffParams: async () => ({
          state: "state",
          codeChallenge: "code-challenge",
        }),
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "afterCallbackRedirectUrl": "https://app.example.test/callback",
        "codeChallenge": "code-challenge",
        "redirectUri": "https://app.example.test/handler/oauth-callback?hexclave_cross_domain_auth=1&hexclave_cross_domain_state=state&hexclave_cross_domain_code_challenge=code-challenge&hexclave_cross_domain_after_callback_redirect_url=https%3A%2F%2Fapp.example.test%2Fcallback",
        "state": "state",
        "type": "cross-domain-authorize",
      }
    `);
  });
});
