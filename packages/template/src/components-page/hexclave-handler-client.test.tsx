import { KnownErrors } from "@hexclave/shared";
import { describe, expect, it, vi } from "vitest";
import { hexclaveAppInternalsSymbol } from "../lib/hexclave-app";
import type { StackClientApp } from "../lib/hexclave-app/apps/interfaces/client-app";
import { getRedirectToPageResult } from "./hexclave-handler-client";

vi.mock("next/navigation", () => ({
  RedirectType: {
    replace: "replace",
  },
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

function createAppTestDouble(options: {
  redirectToHandler: (name: string, options: { replace: true }) => Promise<void>,
}) {
  const projectId = "00000000-0000-4000-8000-000000000000";
  const app = {
    projectId,
    urls: {
      handler: "http://localhost/handler",
      signIn: `https://${projectId}.example-stack-hosted.test/handler/sign-in`,
      home: "http://localhost",
    },
    redirectToHome: vi.fn(async () => {}),
    [hexclaveAppInternalsSymbol]: {
      getConstructorOptions: () => ({ urls: {} }),
      redirectToHandler: options.redirectToHandler,
    },
  };

  // This test double intentionally implements only the StackClientApp surface
  // that HexclaveHandlerClient touches in this redirect path.
  return app as unknown as StackClientApp<true>;
}

describe("HexclaveHandlerClient", () => {
  it("returns known cross-domain redirect errors instead of treating them as unhandled async failures", async () => {
    const redirectToHandler = vi.fn(async () => {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    });
    const app = createAppTestDouble({ redirectToHandler });

    const result = await getRedirectToPageResult(app, "signIn");

    expect(redirectToHandler).toHaveBeenCalledWith("signIn", { replace: true });
    expect(result.status).toBe("known-error");
    if (result.status === "known-error") {
      expect(result.error.errorCode).toBe("REDIRECT_URL_NOT_WHITELISTED");
      expect(result.error.message).toContain("Redirect URL not whitelisted");
    }
  });
});
