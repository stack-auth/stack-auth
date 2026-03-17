import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHandlerUrls, resolveUnknownHandlerPathFallbackUrl } from "./url-targets";

describe("handler URL targets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats handler-component targets the same as omitted values", () => {
    const urls = resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        handler: "/custom-handler",
        signIn: { type: "handler-component" },
      },
    });

    expect(urls.signIn).toBe("/custom-handler/sign-in");
  });

  it("uses hosted defaults for unspecified URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX", ".example-stack-hosted.test");

    const urls = resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        signUp: "/sign-up",
        default: { type: "hosted" },
      },
    });

    expect(urls.signUp).toBe("/sign-up");
    expect(urls.signIn).toBe("https://project-id.example-stack-hosted.test/handler/sign-in");
  });

  it("uses default target for unknown /handler/* pages", () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX", ".example-stack-hosted.test");

    const url = resolveUnknownHandlerPathFallbackUrl({
      defaultTarget: { type: "hosted" },
      projectId: "project-id",
      unknownPath: "custom-page",
    });

    expect(url).toBe("https://project-id.example-stack-hosted.test/handler/custom-page");
  });

  it("uses the full hosted handler URL template when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE", "http://localhost:${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}09/{projectId}/{hostedPath}");
    vi.stubEnv("NEXT_PUBLIC_STACK_PORT_PREFIX", "93");

    const urls = resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        default: { type: "hosted" },
      },
    });

    expect(urls.signIn).toBe("http://localhost:9309/project-id/handler/sign-in");
    expect(urls.accountSettings).toBe("http://localhost:9309/project-id/handler/account-settings");
  });

  it("validates the hosted handler URL template placeholders", () => {
    vi.stubEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE", "http://localhost:9309/{projectId}/handler");

    expect(() => resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        default: { type: "hosted" },
      },
    })).toThrowError(/\{projectId\} and \{hostedPath\}/);
  });
});
