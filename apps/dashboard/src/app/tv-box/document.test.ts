import { describe, expect, it } from "vitest";
import { createTvFixtureSnapshot, getTvProfileFixture } from "@/lib/tv-mode/fixtures";
import { createTvBoxDocument, resolveTvBoxApiConfiguration } from "./document";

function createFixtureSnapshot() {
  const profile = getTvProfileFixture("company-pulse");
  if (profile == null) throw new Error("Missing company-pulse test fixture.");
  return createTvFixtureSnapshot("tv-box-document-test", profile);
}

describe("TV Box HTML document", () => {
  it("contains only the framework-free TV Box assets", () => {
    const document = createTvBoxDocument({
      mode: "live",
      api: { mode: "configured", apiBaseUrl: "https://api.example.com" },
    });

    expect(document).toContain('<link rel="stylesheet" href="/tv-box/tv-box.css">');
    expect(document).toContain('<script type="module" src="/tv-box/app.mjs"></script>');
    expect(document).toContain('id="tv-box-stage"');
    expect(document).toContain('id="tv-box-celebration-background"');
    expect(document).toContain('id="tv-box-celebration-foreground"');
    expect(document).not.toContain("<canvas");
    expect(document).toContain('id="tv-box-footer"');
    expect(document).toContain('id="tv-box-controls"');
    expect(document).toContain('"mode":"live","api":{"mode":"configured","apiBaseUrl":"https://api.example.com"}');
    expect(document).not.toContain("/_next/");
    expect(document).not.toContain("react");
  });

  it("escapes configuration values before embedding them in HTML", () => {
    const document = createTvBoxDocument({
      mode: "live",
      api: { mode: "configured", apiBaseUrl: "https://api.example.com/<script>" },
    });

    expect(document).not.toContain("<script></script>");
    expect(document).toContain("\\u003cscript>");
  });

  it("embeds fixture previews without an API transport", () => {
    const document = createTvBoxDocument({
      mode: "fixture-preview",
      snapshot: createFixtureSnapshot(),
    });

    expect(document).toContain('"mode":"fixture-preview","snapshot"');
    expect(document).not.toContain('"api"');
  });
});

describe("TV Box API origin selection", () => {
  it("uses the configured browser API outside Quick Tunnel development", () => {
    expect(resolveTvBoxApiConfiguration({
      configuredApiUrl: "https://api.hexclave.com",
      configuredBrowserApiUrl: "https://browser-api.hexclave.com",
      nodeEnvironment: "production",
      quickTunnelEnabled: false,
    })).toEqual({ mode: "configured", apiBaseUrl: "https://browser-api.hexclave.com" });
  });

  it("uses the browser origin only for the explicit development transport", () => {
    expect(resolveTvBoxApiConfiguration({
      configuredApiUrl: "http://localhost:8102",
      configuredBrowserApiUrl: undefined,
      nodeEnvironment: "development",
      quickTunnelEnabled: true,
    })).toEqual({ mode: "browser-origin" });
  });

  it("rejects the Quick Tunnel transport outside development", () => {
    expect(() => resolveTvBoxApiConfiguration({
      configuredApiUrl: "https://api.hexclave.com",
      configuredBrowserApiUrl: undefined,
      nodeEnvironment: "production",
      quickTunnelEnabled: true,
    })).toThrowError(/cannot be used outside development/);
  });
});
