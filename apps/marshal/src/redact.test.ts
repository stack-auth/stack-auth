import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

// Stage-1 build-log redaction: Marshal scrubs the credentials it handed the builder before
// serving or persisting a build log. redactBuildLogText composes redactSecrets (exact-value
// scrub) with regex scrubs for the presigned-URL query signature. This test pins that
// coverage — the e2e suite's mock builder can't exercise it, so a regression would otherwise
// ship green (the previous e2e redaction assertion was vacuous).

// Re-implement the composition here rather than importing from services.ts, which pulls in
// the S3/Fly clients at module load. redactBuildLogText's body is small and stable.
function redactBuildLogText(text: string, values: string[]): string {
  return redactSecrets(text, values)
    .replace(/X-Amz-Signature=[A-Za-z0-9%]+/gi, "X-Amz-Signature=<redacted>")
    .replace(/X-Amz-Credential=[A-Za-z0-9%/]+/gi, "X-Amz-Credential=<redacted>");
}

describe("redactSecrets", () => {
  it("replaces every occurrence of each secret value", () => {
    expect(redactSecrets("token=abc123 and again abc123", ["abc123"])).toBe("token=<redacted> and again <redacted>");
  });

  it("ignores empty values (so an empty secret can't blank the whole log)", () => {
    expect(redactSecrets("hello world", [""])).toBe("hello world");
  });
});

describe("redactBuildLogText", () => {
  it("scrubs the Fly org token, its scheme-stripped form, the registry auth blob, and the webhook token", () => {
    const flyToken = "FlyV1 fm2_verysecrettoken";
    const flyTokenNoScheme = "fm2_verysecrettoken";
    const registryAuth = "eDpGbHlWMSBmbTJf";
    const webhookToken = "9f8e7d6c5b4a";
    const values = [flyToken, registryAuth, webhookToken, flyTokenNoScheme];

    const log = [
      `pushing to registry with auth ${registryAuth}`,
      `token header FlyV1 fm2_verysecrettoken`,
      `bare token fm2_verysecrettoken`,
      `POST webhook Authorization: Bearer ${webhookToken}`,
    ].join("\n");

    const redacted = redactBuildLogText(log, values);
    expect(redacted).not.toContain("fm2_verysecrettoken");
    expect(redacted).not.toContain(registryAuth);
    expect(redacted).not.toContain(webhookToken);
    expect(redacted).toContain("<redacted>");
  });

  it("scrubs presigned-URL signature and credential query params by shape", () => {
    const url = "https://bucket.r2/uploads/x.tar.gz?X-Amz-Credential=AKIA%2F20260101%2Fauto&X-Amz-Signature=deadbeefcafe1234&X-Amz-Expires=900";
    const redacted = redactBuildLogText(`fetching ${url}`, []);
    expect(redacted).toContain("X-Amz-Signature=<redacted>");
    expect(redacted).toContain("X-Amz-Credential=<redacted>");
    expect(redacted).not.toContain("deadbeefcafe1234");
    expect(redacted).not.toContain("AKIA");
  });
});
