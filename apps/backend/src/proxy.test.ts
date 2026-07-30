import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("backend CORS preflight", () => {
  it("allows the TV snapshot contract header used by browser playback", async () => {
    const response = await proxy(new NextRequest(
      "http://localhost:8102/api/v1/internal/tv-mode/profiles/company-pulse/snapshot",
      {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:8101",
          "access-control-request-method": "GET",
          "access-control-request-headers": "x-hexclave-tv-snapshot-contract",
        },
      },
    ));

    expect(response.headers.get("access-control-allow-headers"))
      .toContain("x-hexclave-tv-snapshot-contract");
  });
});
