import { describe, expect, it } from "vitest";
import { planRedirectToHandler } from "./redirect-page-urls";

const defaultAfterAuthUrl = "/";
const localOAuthCallbackUrl = "/handler/oauth-callback";

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
  it.each(["afterSignIn", "afterSignUp"] as const)(
    "falls back to the default when %s_auth_return_to points to the current page",
    async (handlerName) => {
      await expect(
        planAfterAuthRedirect(
          handlerName,
          "https://hosted.example.test/handler/sign-in?after_auth_return_to=%2Fhandler%2Fsign-in",
        ),
      ).resolves.toEqual({
        type: "redirect",
        url: defaultAfterAuthUrl,
      });
    },
  );

  it("honors a different after_auth_return_to path", async () => {
    await expect(
      planAfterAuthRedirect(
        "afterSignIn",
        "https://hosted.example.test/handler/sign-in?after_auth_return_to=%2Fdashboard",
      ),
    ).resolves.toEqual({
      type: "redirect",
      url: "/dashboard",
    });
  });

  it("treats query and hash differences on the current path as self-referential", async () => {
    await expect(
      planAfterAuthRedirect(
        "afterSignUp",
        "https://hosted.example.test/handler/sign-in?after_auth_return_to=%2Fhandler%2Fsign-in%3Ftab%3Dpassword%23details",
      ),
    ).resolves.toEqual({
      type: "redirect",
      url: defaultAfterAuthUrl,
    });
  });
});
