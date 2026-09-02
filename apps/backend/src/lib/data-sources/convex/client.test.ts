import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { describe, expect, it } from "vitest";
import { assertSafeDeploymentUrl, isInvalidCursorError, ConvexRequestError, CONVEX_INVALID_CURSOR_CODE } from "./client";

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
