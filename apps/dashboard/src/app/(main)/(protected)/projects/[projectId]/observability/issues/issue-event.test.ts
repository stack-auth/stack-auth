import { describe, expect, it } from "vitest";
import type { IssueFrame, IssueOccurrence } from "./issues-data";
import { getIssueEventPayload } from "./issue-event";

function occurrence(data: Record<string, unknown>): Pick<IssueOccurrence, "data"> {
  return { data };
}

describe("issue event payload", () => {
  it("reads the rich exception bridge and only allowlists request fields", () => {
    const payload = getIssueEventPayload(occurrence({
      event_id: "0123456789abcdef0123456789abcdef",
      extra: {
        exception: {
          values: [{
            type: "TypeError",
            value: "bad value",
            stacktrace: { frames: [{ filename: "app.ts", function: "run", lineno: 4 }] },
          }],
        },
      },
      request: {
        url: "https://example.test/path?token=hidden",
        method: "POST",
        status_code: 500,
        headers: { authorization: "secret" },
        body: "private",
      },
    }));

    expect(payload.eventId).toBe("0123456789abcdef0123456789abcdef");
    expect(payload.exceptionChain[0]).toMatchObject({ type: "TypeError", value: "bad value" });
    expect(payload.exceptionChain[0]?.frames).toHaveLength(1);
    expect(payload.safeRequest?.fields).toEqual([
      { key: "URL", value: "https://example.test/path" },
      { key: "Method", value: "POST" },
      { key: "Status", value: 500 },
    ]);
    expect(JSON.stringify(payload.additionalData)).not.toContain("authorization");
    expect(JSON.stringify(payload.additionalData)).not.toContain("private");
  });

  it("does not expose opaque or sensitive fields through the display projection", () => {
    const payload = getIssueEventPayload(occurrence({
      message: "failure",
      secret: "should not render",
      request: { query_string: "password=should-not-render" },
      tags: { tenant: "alpha" },
      contexts: { browser: { name: "fixture" } },
      breadcrumbs: [{ timestamp: 1_700_000_000, category: "http", message: "GET /health", data: { status: 200 } }],
    }));

    expect(payload.tags).toEqual([{ key: "tenant", value: "alpha" }]);
    expect(payload.contexts).toEqual([{ key: "browser", value: { name: "fixture" } }]);
    expect(payload.breadcrumbs[0]).toMatchObject({ category: "http", message: "GET /health" });
    expect(payload.safeRequest?.fields).toEqual([]);
    expect(payload.additionalData).toEqual([]);
  });

  it("redacts nested extras and breadcrumb data at the display boundary", () => {
    const payload = getIssueEventPayload(occurrence({
      extra: { safe: { value: "ok", token: "hidden" } },
      breadcrumbs: [{ data: { url: "https://example.test/path?token=hidden", authorization: "Bearer hidden", status: 200 } }],
    }));

    expect(payload.extra).toEqual([{ key: "safe", value: { value: "ok" } }]);
    expect(payload.breadcrumbs[0]?.data).toEqual({ status: 200, url: "https://example.test/path" });
  });

  it("renders symbolicated exception locations while preserving the raw frame", () => {
    const payload = getIssueEventPayload(occurrence({
      exception: {
        values: [{
          stacktrace: {
            frames: [{
              filename: "static/chunk.js",
              function: "a",
              abs_path: "static/chunk.js",
              lineno: 2,
              colno: 1,
              symbolication: {
                status: "symbolicated",
                source_file: "src/app.ts?token=source-secret",
                original_line: 10,
                original_column: 4,
                name: "handleRequest",
                context: {
                  pre: ["const safe = true;"],
                  line: "throw new Error(\"boom\");",
                  post: ["Authorization: Bearer source-secret"],
                },
                diagnostics: [{
                  code: "artifact_mismatch",
                  message: "artifact mismatch for Bearer source-secret",
                  debug_id: "01234567-89ab-cdef-0123-456789abcdef",
                  code_file: "static/chunk.js",
                }],
              },
            }],
          },
        }],
      },
    }));

    const frame = payload.exceptionChain[0]?.frames[0];
    expect(frame).toMatchObject({
      filename: "src/app.ts?token=[Filtered]",
      function: "handleRequest",
      abs_path: "src/app.ts?token=[Filtered]",
      lineno: 10,
      colno: 4,
      context: {
        line: "throw new Error(\"boom\");",
        pre: ["const safe = true;"],
        post: ["Authorization: Bearer [Filtered]"],
        symbolicated: true,
      },
      raw: {
        filename: "static/chunk.js",
        function: "a",
        abs_path: "static/chunk.js",
        lineno: 2,
        colno: 1,
      },
      symbolication: {
        status: "symbolicated",
        sourceFile: "src/app.ts?token=[Filtered]",
        originalLine: 10,
        originalColumn: 4,
        name: "handleRequest",
      },
    });
    expect(frame.symbolication?.diagnostics[0].message).toBe("artifact mismatch for Bearer [Filtered]");
    expect(payload.symbolicationDiagnostics[0]?.code).toBe("artifact_mismatch");
  });

  it("reports the current raw-frame projection as an explicit no-op seam", () => {
    const rawFrame: IssueFrame = {
      filename: "static/chunk.js",
      function: "a",
      module: null,
      abs_path: "static/chunk.js",
      lineno: 2,
      colno: 1,
      in_app: true,
    };
    const payload = getIssueEventPayload({ data: {}, frames: [rawFrame] });

    expect(payload.occurrenceFrames[0]?.symbolication).toBeNull();
    expect(payload.symbolicationDiagnostics).toContainEqual(expect.objectContaining({
      code: "projection_missing",
      message: expect.stringContaining("internal issue route/schema"),
    }));
  });
});
