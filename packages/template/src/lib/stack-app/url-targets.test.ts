import { afterEach, describe, expect, it, vi } from "vitest";
import { getPagePrompt, isLocalHandlerUrlTarget, resolveHandlerUrls, resolveUnknownHandlerPathFallbackUrl } from "./url-targets";

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

  it("treats custom v0 page targets like legacy string targets", () => {
    const urls = resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        handler: "/custom-handler",
        signIn: { type: "handler-component" },
        signUp: { type: "custom", url: "/sign-up-explicit", version: 0 },
      },
    });

    expect(urls.signIn).toBe("/custom-handler/sign-in");
    expect(urls.signUp).toBe("/sign-up-explicit");
  });

  it("throws on v0 custom target for handler page", () => {
    expect(() => resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        handler: { type: "custom", url: "/custom-handler", version: 0 },
      },
    })).toThrowError(/cannot be a custom page/);
  });

  it("supports the latest documented custom target version", () => {
    const signInPrompt = getPagePrompt("signIn");
    if (signInPrompt == null) {
      throw new Error("Expected signIn prompt metadata to exist");
    }

    const urls = resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        signIn: { type: "custom", url: "/custom-sign-in", version: signInPrompt.latestVersion },
      },
    });

    expect(urls.signIn).toBe("/custom-sign-in");
  });

  it("throws on custom target versions newer than the latest supported version", () => {
    const signInPrompt = getPagePrompt("signIn");
    if (signInPrompt == null) {
      throw new Error("Expected signIn prompt metadata to exist");
    }

    expect(() => resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        signIn: { type: "custom", url: "/custom-sign-in", version: signInPrompt.latestVersion + 1 },
      },
    })).toThrowError(/Unsupported custom page version/);
  });

  it("throws on non-zero custom version for handler page", () => {
    expect(() => resolveHandlerUrls({
      projectId: "project-id",
      urls: {
        handler: { type: "custom", url: "/custom-handler", version: 1 },
      },
    })).toThrowError(/cannot be a custom page/);
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

describe("isLocalHandlerUrlTarget", () => {
  it("treats relative handler URLs as local targets", () => {
    expect(isLocalHandlerUrlTarget({
      targetUrl: "/handler/sign-in",
      handlerPath: "/handler",
      currentOrigin: "http://p91.localhost:9101",
    })).toBe(true);
  });

  it("treats same-origin absolute handler URLs as local targets", () => {
    expect(isLocalHandlerUrlTarget({
      targetUrl: "http://p91.localhost:9101/handler/sign-in",
      handlerPath: "/handler",
      currentOrigin: "http://p91.localhost:9101",
    })).toBe(true);
  });

  it("treats cross-origin absolute handler URLs as non-local targets", () => {
    expect(isLocalHandlerUrlTarget({
      targetUrl: "https://project-id.built-with-stack-auth.com/handler/sign-in",
      handlerPath: "/handler",
      currentOrigin: "http://p91.localhost:9101",
    })).toBe(false);
  });

  it("treats non-handler paths as non-local targets", () => {
    expect(isLocalHandlerUrlTarget({
      targetUrl: "/projects",
      handlerPath: "/handler",
      currentOrigin: "http://p91.localhost:9101",
    })).toBe(false);
  });
});
