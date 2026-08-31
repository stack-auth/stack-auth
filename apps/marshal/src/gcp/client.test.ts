import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationOutcomeUnknownError } from "../mutation-safety.js";

vi.mock("./auth.js", () => ({ googleAccessToken: async () => "test-access-token" }));

import { GcpApiError, GcpClient } from "./client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Google Cloud API transport", () => {
  it("routes mock mode through the local simulator with its isolated token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new GcpClient({ url: "http://127.0.0.1:18148", token: "mock-token" })
      .request("https://cloudresourcemanager.googleapis.com/v3/projects:search?query=id%3Atenant");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18148/googleapis/cloudresourcemanager.googleapis.com/v3/projects:search?query=id%3Atenant",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer mock-token" }) }),
    );
  });

  it("fences a mutation whose response outcome is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection reset");
    }));
    await expect(new GcpClient().request("https://run.googleapis.com/v2/projects/tenant/services/web?updateMask=*", {
      method: "PATCH",
      body: { name: "web" },
    })).rejects.toBeInstanceOf(MutationOutcomeUnknownError);
  });

  it("preserves provider detail for server logs while normalizing the endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "permission denied for an internal tenant resource" },
    }), { status: 403 })));
    const error = await new GcpClient().request("https://run.googleapis.com/v2/projects/tenant/services/web?view=FULL")
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(GcpApiError);
    expect(error).toMatchObject({ status: 403, endpoint: "/v2/projects/tenant/services/web" });
    expect(String(error)).toContain("permission denied");
    expect(String(error)).not.toContain("view=FULL");
  });

  it("retries the explicit newly-enabled API propagation response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Compute Engine API has not been used in project tenant before or it is disabled. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry." },
      }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "DONE" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new GcpClient().request("https://compute.googleapis.com/compute/v1/projects/tenant/global/operations/operation-1");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ status: "DONE" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
