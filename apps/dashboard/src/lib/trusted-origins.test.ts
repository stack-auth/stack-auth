import { describe, expect, it } from "vitest";
import { getTrustedOriginOptions, normalizeTrustedOrigin } from "./trusted-origins";

describe("trusted origin options", () => {
  it("keeps wildcard domains out of launchable origins", () => {
    expect(getTrustedOriginOptions({
      wildcard: { baseUrl: "https://**.stack-auth.com" },
      concrete: { baseUrl: "https://app.stack-auth.com/path?x=1" },
      duplicate: { baseUrl: "https://app.stack-auth.com/other" },
    })).toMatchInlineSnapshot(`
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
    expect(normalizeTrustedOrigin("https://app.dev.stack-auth.com/dashboard")).toMatchInlineSnapshot(`"https://app.dev.stack-auth.com"`);
    expect(normalizeTrustedOrigin("javascript:alert(1)")).toMatchInlineSnapshot(`null`);
  });

  it("rejects wildcard origins to prevent percent-encoded URLs", () => {
    expect(normalizeTrustedOrigin("https://**.example.com")).toMatchInlineSnapshot(`null`);
    expect(normalizeTrustedOrigin("https://*.stack-auth.com")).toMatchInlineSnapshot(`null`);
  });

  it("does not treat asterisk characters outside the hostname as wildcards", () => {
    expect(getTrustedOriginOptions({
      path: { baseUrl: "https://app.stack-auth.com/path*?query=*" },
    })).toMatchInlineSnapshot(`
      {
        "origins": [
          {
            "id": "path",
            "origin": "https://app.stack-auth.com",
          },
        ],
        "wildcardDomains": [],
      }
    `);
  });

  it("does not synthesize a portless localhost origin", () => {
    expect(getTrustedOriginOptions({}).origins).toHaveLength(0);
  });
});
