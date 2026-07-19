import { describe, expect, it, vi } from "vitest";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import {
  evaluateFlagWithoutExposure,
  FeatureFlagsBackendUnavailableError,
  getExperimentResults,
  getFeatureFlagActivity,
  getLastExposures,
  listExperimentRuns,
  transitionExperimentRun,
} from "./admin-adapter";

// Mocks are declared with the transport's real parameter list so both the
// assignability into the internals object and `mock.calls[i][j]` indexing stay
// fully typed (a zero-arg vi.fn() would type calls as an empty tuple).
function createSendRequestMock(respond: () => Response) {
  return vi.fn(async (
    _path: string,
    _requestOptions: RequestInit,
    _requestType?: "client" | "server" | "admin",
  ) => respond());
}

type SendRequestMock = ReturnType<typeof createSendRequestMock>;

function makeAdminApp(sendRequest: SendRequestMock): object {
  return { [hexclaveAppInternalsSymbol]: { sendRequest } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_RUN = {
  experimentId: "experiment-1",
  status: "running",
  startedAtIso: "2026-07-01T00:00:00.000Z",
  completedAtIso: null,
  totalExposures: 1234,
  exposuresByVariant: [{ variantId: "variant-on", exposures: 620 }],
  winnerVariantId: null,
};

describe("unavailability detection", () => {
  it("maps 404 responses to FeatureFlagsBackendUnavailableError", async () => {
    const sendRequest = createSendRequestMock(() => new Response("not found", { status: 404 }));
    await expect(listExperimentRuns(makeAdminApp(sendRequest)))
      .rejects.toBeInstanceOf(FeatureFlagsBackendUnavailableError);
  });

  it("maps 501 responses to FeatureFlagsBackendUnavailableError", async () => {
    const sendRequest = createSendRequestMock(() => new Response("not implemented", { status: 501 }));
    await expect(getLastExposures(makeAdminApp(sendRequest)))
      .rejects.toBeInstanceOf(FeatureFlagsBackendUnavailableError);
  });

  it("throws a regular error for other failure statuses", async () => {
    const sendRequest = createSendRequestMock(() => new Response("boom", { status: 500 }));
    await expect(listExperimentRuns(makeAdminApp(sendRequest)))
      .rejects.toThrowError(/500/);
  });
});

describe("listExperimentRuns", () => {
  it("parses runs and uses the admin transport", async () => {
    const sendRequest = createSendRequestMock(() => jsonResponse({ runs: [SAMPLE_RUN] }));
    const runs = await listExperimentRuns(makeAdminApp(sendRequest));
    expect(runs).toEqual([SAMPLE_RUN]);
    expect(sendRequest).toHaveBeenCalledWith(
      "/internal/feature-flags/experiment-runs",
      { method: "GET" },
      "admin",
    );
  });

  it("rejects malformed responses with a descriptive error", async () => {
    const sendRequest = createSendRequestMock(() => jsonResponse({ runs: [{ ...SAMPLE_RUN, status: "exploded" }] }));
    await expect(listExperimentRuns(makeAdminApp(sendRequest)))
      .rejects.toThrowError(/status/);
  });
});

describe("transitionExperimentRun", () => {
  it("POSTs the transition and returns the updated run", async () => {
    const sendRequest = createSendRequestMock(() => jsonResponse({ ...SAMPLE_RUN, status: "paused" }));
    const run = await transitionExperimentRun(makeAdminApp(sendRequest), "experiment-1", "pause");
    expect(run.status).toBe("paused");
    expect(sendRequest).toHaveBeenCalledWith(
      "/internal/feature-flags/experiment-runs/experiment-1/pause",
      { method: "POST" },
      "admin",
    );
  });
});

describe("getExperimentResults", () => {
  it("encodes filters as query parameters and parses the response", async () => {
    const results = {
      totalExposures: 100,
      exposuresByVariant: [{ variantId: "variant-on", exposures: 50, expectedBps: 5000 }],
      srm: { detected: false, pValue: 0.8 },
      metrics: [{
        metricId: "metric-1",
        guardrailBreached: false,
        perVariant: [{
          variantId: "variant-on",
          exposures: 50,
          value: 10,
          conversionRate: 0.2,
          liftVsControl: null,
          credibleIntervalLow: 0.1,
          credibleIntervalHigh: 0.3,
          probabilityBest: 0.6,
        }],
      }],
      insufficientData: true,
      minimumExposuresPerVariant: 500,
    };
    const sendRequest = createSendRequestMock(() => jsonResponse(results));
    const parsed = await getExperimentResults(makeAdminApp(sendRequest), "experiment-1", {
      segmentId: "beta-testers",
      sinceIso: "2026-07-01T00:00:00.000Z",
    });
    expect(parsed).toEqual(results);
    const requestedPath: unknown = sendRequest.mock.calls[0]?.[0];
    expect(requestedPath).toBe(
      "/internal/feature-flags/experiment-runs/experiment-1/results?segment_id=beta-testers&since=2026-07-01T00%3A00%3A00.000Z",
    );
  });
});

describe("getFeatureFlagActivity", () => {
  it("passes filters and parses entries", async () => {
    const entry = {
      id: "activity-1",
      timestampIso: "2026-07-01T00:00:00.000Z",
      kind: "lifecycle",
      flagKey: "checkout-redesign",
      experimentId: null,
      actor: "jamie@example.com",
      message: "Experiment started",
    };
    const sendRequest = createSendRequestMock(() => jsonResponse({ entries: [entry] }));
    const entries = await getFeatureFlagActivity(makeAdminApp(sendRequest), { kind: "lifecycle", flagKey: "checkout-redesign" });
    expect(entries).toEqual([entry]);
    const requestedPath: unknown = sendRequest.mock.calls[0]?.[0];
    expect(requestedPath).toBe("/internal/feature-flags/activity?kind=lifecycle&flag_key=checkout-redesign");
  });
});

describe("evaluateFlagWithoutExposure", () => {
  it("always sends recordExposure: false and serializes the context", async () => {
    const sendRequest = createSendRequestMock(() => jsonResponse({
      variantId: "variant-on",
      jsonValue: "true",
      reason: "Matched rule",
      matchedRuleId: "rule-1",
    }));
    const result = await evaluateFlagWithoutExposure(makeAdminApp(sendRequest), "checkout-redesign", {
      userId: "user-1",
      email: null,
      teamId: null,
      environment: "production",
      customAttributes: new Map([["plan", "pro"]]),
    });
    expect(result.variantId).toBe("variant-on");
    const requestInit: unknown = sendRequest.mock.calls[0]?.[1];
    if (requestInit == null || typeof requestInit !== "object" || !("body" in requestInit) || typeof requestInit.body !== "string") {
      throw new Error("Expected the evaluate call to send a JSON string body");
    }
    const body: unknown = JSON.parse(requestInit.body);
    expect(body).toEqual({
      flagKey: "checkout-redesign",
      recordExposure: false,
      context: {
        userId: "user-1",
        email: null,
        teamId: null,
        environment: "production",
        customAttributes: { plan: "pro" },
      },
    });
  });
});

describe("internals access", () => {
  it("fails loudly when the app does not expose internals", async () => {
    await expect(listExperimentRuns({})).rejects.toThrowError(/internals/);
  });
});
