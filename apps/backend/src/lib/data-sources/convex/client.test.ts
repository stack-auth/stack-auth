import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { describe, expect, it } from "vitest";
import { assertSafeDeploymentUrl, describeFailure, isInvalidCursorError, ConvexRequestError, CONVEX_INVALID_CURSOR_CODE } from "./client";

describe("recognising a cursor Convex can no longer read", () => {
  it("matches Convex's own code, and nothing else", () => {
    // The consequence of getting this wrong is destructive: the caller responds
    // by rebuilding every destination table from a fresh snapshot, so a timeout
    // or a 502 must not look like a dead cursor.
    expect(isInvalidCursorError(new ConvexRequestError(400, CONVEX_INVALID_CURSOR_CODE, "…"))).toBe(true);
    expect(isInvalidCursorError(new ConvexRequestError(400, "SomethingElse", "…"))).toBe(false);
    expect(isInvalidCursorError(new ConvexRequestError(502, null, "…"))).toBe(false);
    expect(isInvalidCursorError(new StatusError(StatusError.BadRequest, "Could not reach the Convex deployment"))).toBe(false);
    expect(isInvalidCursorError(new Error("socket hang up"))).toBe(false);
  });

  it("does not accept the code on a status Convex never pairs it with", () => {
    // The code is a string chosen by the deployment we are talking to. Without
    // the status check, a 502 whose body happens to carry it would drop and
    // rebuild every one of the customer's destination tables.
    expect(isInvalidCursorError(new ConvexRequestError(502, CONVEX_INVALID_CURSOR_CODE, "…"))).toBe(false);
    expect(isInvalidCursorError(new ConvexRequestError(500, CONVEX_INVALID_CURSOR_CODE, "…"))).toBe(false);
  });

  it("is the code the live backend actually returns", () => {
    // Verified against a self-hosted Convex backend: POSTing a malformed cursor
    // to /api/v1/data/sync gives 400 {"code":"InvalidDataSyncCursor"}.
    expect(CONVEX_INVALID_CURSOR_CODE).toBe("InvalidDataSyncCursor");
  });
});

describe("deployment URLs", () => {
  it("accepts an ordinary Convex deployment URL", () => {
    expect(assertSafeDeploymentUrl("https://acoustic-panther-728.convex.cloud").hostname)
      .toBe("acoustic-panther-728.convex.cloud");
  });

  it("refuses anything that is not http(s)", () => {
    // A file: or gopher: URL would otherwise be handed to the transport.
    for (const url of ["file:///etc/passwd", "gopher://example.com", "ftp://example.com"]) {
      expect(() => assertSafeDeploymentUrl(url), url).toThrow("must use http(s)");
    }
  });

  it("refuses text that is not a URL at all", () => {
    for (const url of ["", "not a url", "convex.cloud"]) {
      expect(() => assertSafeDeploymentUrl(url), url).toThrow("must use http(s)");
    }
  });
});

describe("explaining why Convex refused", () => {
  const body = (code: string) => JSON.stringify({ code, message: "some upstream prose" });

  it("names the real cause when streaming export is off, rather than blaming the key", () => {
    // Convex answers 403 both for a bad key and for a deployment that simply has
    // streaming export switched off. Reading the status alone sends someone off
    // to re-issue a perfectly good deploy key — which is exactly what happened.
    const error = describeFailure(403, body("StreamingExportNotEnabled"), "/api/json_schemas");

    expect(error.message).toContain("streaming export");
    expect(error.message).toContain("Integrations");
    expect(error.message).not.toContain("deploy key");
  });

  it("still blames the key when Convex says the key is the problem", () => {
    expect(describeFailure(403, body("InvalidDeployKey"), "/api/json_schemas").message)
      .toContain("deploy key");
    // An unrecognised 403 falls back to the key, which is the likeliest cause.
    expect(describeFailure(401, "{}", "/api/json_schemas").message).toContain("deploy key");
  });

  it("never repeats the response body back to the caller", () => {
    // The deployment URL is customer-supplied, so the body is attacker-chosen
    // content; it must not reach an error the API returns and persists.
    const error = describeFailure(500, JSON.stringify({ code: "Whatever", message: "SECRET-INTERNAL-RESPONSE" }), "/api/json_schemas");

    expect(error.message).not.toContain("SECRET-INTERNAL-RESPONSE");
    expect(error.message).toBe("Convex returned 500.");
    // Kept for branching and for the error tracker, just not shown to anyone.
    expect(error.convexCode).toBe("Whatever");
  });

  it("does not echo an unrecognised code into a message a customer will read", () => {
    // Identifier characters are enough to write a sentence. This message is
    // returned by the API and persisted on DataSource.error, where a project
    // admin reads it with our UI lending it credibility.
    const error = describeFailure(400, JSON.stringify({ code: "Contact_support_at_evil_example_com" }), "/api/json_schemas");

    expect(error.message).not.toContain("evil_example_com");
  });

  it("does not let an inherited object key select a message", () => {
    // `toString` and friends pass the identifier check. A plain object literal
    // would resolve them off Object.prototype and report
    // "function toString() { [native code] }" to the customer.
    for (const code of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
      // 500 has no status fallback of its own, so an inherited hit would show.
      expect(describeFailure(500, JSON.stringify({ code }), "/api/json_schemas").message, code)
        .toBe("Convex returned 500.");
    }
  });

  it("never puts the request path in the customer-facing message", () => {
    // The path is threaded in for the error tracker; it is an internal detail.
    const error = describeFailure(500, "{}", "/api/v1/data/sync");

    expect(error.message).not.toContain("/api/v1/data/sync");
  });

  it("carries the status and code for callers that need to branch", () => {
    const error = describeFailure(400, body(CONVEX_INVALID_CURSOR_CODE), "/api/v1/data/sync");

    expect(error.upstreamStatus).toBe(400);
    expect(isInvalidCursorError(error)).toBe(true);
  });
});
