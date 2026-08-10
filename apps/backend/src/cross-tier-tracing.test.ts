import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const { waitMock } = vi.hoisted(() => ({
  waitMock: vi.fn(async () => {}),
}));

vi.mock("@hexclave/shared/dist/utils/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("@hexclave/shared/dist/utils/promises")>(),
  wait: waitMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  waitMock.mockClear();
});

describe("cross-tier telemetry boundary", () => {
  it("allows standard W3C trace context and baggage through API CORS", async () => {
    vi.stubEnv("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "500");
    const response = await proxy(new NextRequest("http://localhost:8102/api/latest/users", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:8101",
        "access-control-request-headers": "traceparent, tracestate, baggage",
      },
    }));

    expect(response.headers.get("Access-Control-Allow-Headers")?.split(", ")).toEqual(expect.arrayContaining([
      "traceparent",
      "tracestate",
      "baggage",
    ]));
    expect(waitMock).not.toHaveBeenCalled();
  });

  it("keeps telemetry ingestion outside artificial development pressure", async () => {
    vi.stubEnv("STACK_ARTIFICIAL_DEVELOPMENT_DELAY_MS", "500");

    await proxy(new NextRequest("http://localhost:8102/api/v1/analytics/events/batch", {
      method: "POST",
    }));
    expect(waitMock).not.toHaveBeenCalled();

    await proxy(new NextRequest("http://localhost:8102/api/latest/users", {
      method: "GET",
    }));
    expect(waitMock).toHaveBeenCalledWith(500);
  });
});
