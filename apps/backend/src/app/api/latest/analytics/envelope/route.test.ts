import type { Tenancy } from "@/lib/tenancies";
import type { SmartRequest } from "@/route-handlers/smart-request";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseErrorIngestEnvelope } from "@/lib/error-ingest";
import { POST as ingestEnvelope } from "./route";

// The parse boundary must reflect ONLY ErrorIngestEnvelopeError messages
// (fixed strings authored in the envelope parser) as 400s; anything else is an
// internal failure that has to bubble to the generic 500 handler instead of
// leaking its message. The parser is wrapped (not replaced) so the malformed
// cases exercise the real parser.
vi.mock("@/lib/error-ingest", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/error-ingest")>();
  return { ...original, parseErrorIngestEnvelope: vi.fn(original.parseErrorIngestEnvelope) };
});

// Only the fields the parse boundary reads before rejecting (observability
// gate, scope ids). Same fake-by-cast pattern as the ClickHouseClient fakes
// in lib/spans.test.ts; a missing field the route starts relying on before
// the parse boundary will surface as a TypeError in these tests.
const tenancy = {
  id: "11111111-2222-4333-8444-555555555555",
  branchId: "main",
  project: { id: "envelope-route-test-project" },
  config: { apps: { installed: { observability: { enabled: true } } } },
} as unknown as Tenancy;

function request(body: unknown): SmartRequest {
  return {
    auth: {
      type: "server",
      project: tenancy.project,
      branchId: tenancy.branchId,
      tenancy,
    },
    url: "http://localhost/api/latest/analytics/envelope",
    method: "POST",
    body,
    bodyBuffer: new ArrayBuffer(0),
    headers: {},
    query: {},
    params: {},
    clientVersion: undefined,
  };
}

beforeEach(() => {
  vi.mocked(parseErrorIngestEnvelope).mockClear();
});

describe("sentry envelope parse boundary", () => {
  it("returns 400 with the parser's fixed message for a malformed envelope", async () => {
    await expect(ingestEnvelope.invoke(request(new TextEncoder().encode("this is not an envelope"))))
      .rejects.toMatchObject({ name: "StatusError", statusCode: 400, message: "Envelope header is missing its newline" });
  });

  it("returns 400 with a fixed message for a non-binary body", async () => {
    await expect(ingestEnvelope.invoke(request({ not: "binary" })))
      .rejects.toMatchObject({ name: "StatusError", statusCode: 400, message: "Sentry envelope body must be binary" });
  });

  it("does not reflect unexpected parser failures as 400 responses", async () => {
    vi.mocked(parseErrorIngestEnvelope).mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'internal detail')");
    });
    const error = await ingestEnvelope.invoke(request(new Uint8Array([1, 2, 3]))).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    if (error === null) throw new Error("Expected the envelope invocation to reject, but it resolved");
    expect(error).toBeInstanceOf(TypeError);
    expect(StatusError.isStatusError(error)).toBe(false);
  });
});
