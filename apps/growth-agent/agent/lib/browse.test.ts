import { afterEach, describe, expect, it, vi } from "vitest";
import { extractCurlFallbackPage, fetchPageWithCurl, isBrowserSandboxCredentialError, isBrowseSandboxAvailable } from "./browse.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isBrowseSandboxAvailable", () => {
  it("allows local development to use hosted Vercel sandboxes when explicitly pinned", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("HEXCLAVE_GROWTH_SANDBOX_BACKEND", "vercel");
    vi.stubEnv("VERCEL_TOKEN", "token");
    vi.stubEnv("VERCEL_TEAM_ID", "team");
    vi.stubEnv("VERCEL_PROJECT_ID", "project");

    expect(isBrowseSandboxAvailable()).toBe(true);
  });

  it("keeps the browser unavailable when local development is pinned to Docker", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("HEXCLAVE_GROWTH_SANDBOX_BACKEND", "docker");
    vi.stubEnv("VERCEL_TOKEN", "token");
    vi.stubEnv("VERCEL_TEAM_ID", "team");
    vi.stubEnv("VERCEL_PROJECT_ID", "project");

    expect(isBrowseSandboxAvailable()).toBe(false);
  });

  it("accepts automatic OIDC credentials in a Vercel deployment", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "oidc-token");

    expect(isBrowseSandboxAvailable()).toBe(true);
  });

  it("allows a Vercel deployment to use runtime OIDC credentials", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("VERCEL_TOKEN", "token");
    vi.stubEnv("VERCEL_TEAM_ID", "team");
    vi.stubEnv("VERCEL_PROJECT_ID", "");

    expect(isBrowseSandboxAvailable()).toBe(true);
  });
});

describe("curl browser fallback", () => {
  it("only classifies sandbox credential failures as fallback-safe", () => {
    const credentialError = new Error("Could not get credentials from OIDC context.");
    credentialError.name = "VercelOidcContextError";

    expect(isBrowserSandboxCredentialError(credentialError)).toBe(true);
    expect(isBrowserSandboxCredentialError(new Error("Navigation timed out"))).toBe(false);
    expect(isBrowserSandboxCredentialError("not an error object")).toBe(false);
  });

  it("extracts readable static content without scripts or styles", () => {
    const result = extractCurlFallbackPage(`<!doctype html>
      <html><head><title>Acme &amp; Co</title><style>.hidden{display:none}</style></head>
      <body><main><h1>Ship faster</h1><script>steal()</script><p>Public product copy.</p></main></body></html>`,
    "https://example.com/", "https://www.example.com/");

    expect(result).toEqual({
      finalUrl: "https://www.example.com/",
      title: "Acme & Co",
      snapshotText: "[curl fallback: Chromium was unavailable; this is static HTML from https://example.com/ and may omit client-rendered content.]\nShip faster\nPublic product copy.",
    });
  });

  it("leaves invalid numeric HTML entities unchanged", () => {
    const result = extractCurlFallbackPage("<p>Value: &#999999999;</p>", "https://example.com/", "https://example.com/");

    expect(result.snapshotText).toContain("&#999999999;");
  });

  it("passes the URL through the sandbox environment and removes the temporary response", async () => {
    const sandbox = {
      async run() {
        return { exitCode: 0, stdout: "https://example.com/final", stderr: "" };
      },
      async readBinaryFile() {
        return new TextEncoder().encode("<title>Example</title><p>Hello</p>");
      },
      async removePath() {
        return undefined;
      },
    };
    const runSpy = vi.spyOn(sandbox, "run");
    const removeSpy = vi.spyOn(sandbox, "removePath");

    const result = await fetchPageWithCurl({
      url: "https://example.com/search?q=$(unsafe)",
      requestId: "call/example",
      sandbox,
    });

    expect(result.finalUrl).toBe("https://example.com/final");
    expect(runSpy).toHaveBeenCalledWith(expect.objectContaining({
      env: {
        HEXCLAVE_BROWSE_OUTPUT_PATH: "/workspace/browse-page-call_example.untracked.html",
        HEXCLAVE_BROWSE_URL: "https://example.com/search?q=$(unsafe)",
      },
    }));
    expect(removeSpy).toHaveBeenCalledWith({
      path: "/workspace/browse-page-call_example.untracked.html",
      force: true,
      recursive: false,
    });
  });
});
