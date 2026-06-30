import { describe, expect, it } from "vitest";
import { getClickmapOriginOptions, normalizeClickmapOrigin } from "./clickmap-origins";

describe("clickmap origin options", () => {
  it("keeps wildcard domains out of launchable origins", () => {
    const options = getClickmapOriginOptions({
      wildcard: { baseUrl: "https://**.stack-auth.com" },
      concrete: { baseUrl: "https://app.stack-auth.com/path?x=1" },
      duplicate: { baseUrl: "https://app.stack-auth.com/other" },
    });

    expect(options).toMatchInlineSnapshot(`
      {
        "origins": [
          {
            "id": "duplicate",
            "origin": "https://app.stack-auth.com",
          },
        ],
        "wildcardDomains": [
          {
            "baseUrl": "https://**.stack-auth.com",
            "id": "wildcard",
          },
        ],
      }
    `);
  });

  it("normalizes only HTTP(S) origins", () => {
    expect(normalizeClickmapOrigin("https://app.dev.stack-auth.com/dashboard")).toMatchInlineSnapshot(`"https://app.dev.stack-auth.com"`);
    expect(normalizeClickmapOrigin("javascript:alert(1)")).toMatchInlineSnapshot(`null`);
  });

  it("rejects wildcard origins to prevent percent-encoded URLs", () => {
    expect(normalizeClickmapOrigin("https://**.example.com")).toMatchInlineSnapshot(`null`);
    expect(normalizeClickmapOrigin("https://*.stack-auth.com")).toMatchInlineSnapshot(`null`);
  });
});
