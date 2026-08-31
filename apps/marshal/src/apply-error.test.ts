import { describe, expect, it } from "vitest";
import { applyErrorMessage } from "./apply-error.js";
import { badRequest, MarshalError } from "./errors.js";
import { FlyApiError } from "./fly/client.js";

// The stored `error` on a service and on a deployment's per-service outcome is served all
// the way to `hexclave deploy` and the dashboard. These tests pin the one property that
// matters about it: nothing the infrastructure provider said can reach it. A regression
// would leak its wording, its status codes, and the app/org identifiers its endpoints
// embed — and would ship green otherwise, since every caller only ever prints the string.

describe("applyErrorMessage", () => {
  it("relays our own request-level rejections", () => {
    expect(applyErrorMessage(badRequest("config.ports must declare at least one port")))
      .toBe("config.ports must declare at least one port");
    expect(applyErrorMessage(new MarshalError(409, "conflict", "the service was updated too frequently")))
      .toBe("the service was updated too frequently");
  });

  it("names a machine that never booted, without quoting the provider", () => {
    const message = applyErrorMessage(new FlyApiError(408, "machines wait /apps/env-ns-web/machines/abc", "timed out waiting for state started"));
    expect(message).toBe("the service did not start in time. Check its logs for a crash on startup");
  });

  it("never relays a provider error's wording, status or endpoint", () => {
    const error = new FlyApiError(422, "machines POST /apps/env-ns-web/machines", "could not pull image registry.example.com/acme/api:v3: manifest unknown");
    const message = applyErrorMessage(error);
    for (const leaked of ["manifest unknown", "registry.example.com", "env-ns-web", "422", "Fly", "fly"]) {
      expect(message).not.toContain(leaked);
    }
  });

  it("collapses anything that is not ours, including bare errors and non-errors", () => {
    const generic = applyErrorMessage(new FlyApiError(500, "graphql", "internal server error"));
    // A raw Error is not necessarily provider-free either — a fetch/TypeError message can
    // carry the URL it was talking to — so it collapses to the same text.
    expect(applyErrorMessage(new Error("fetch failed: connect ECONNREFUSED api.machines.dev"))).toBe(generic);
    expect(applyErrorMessage("a thrown string")).toBe(generic);
    expect(applyErrorMessage(undefined)).toBe(generic);
    expect(generic).toContain("could not be deployed");
  });
});
