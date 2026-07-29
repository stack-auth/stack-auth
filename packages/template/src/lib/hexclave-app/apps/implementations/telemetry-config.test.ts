import { describe, expect, it } from "vitest";
import { requireTelemetryResource, snapshotTelemetryOptions, telemetryOptionsToJson } from "./telemetry-config";

describe("telemetry resource config", () => {
  it("fails loudly when delivery has no explicit service identity", () => {
    expect(() => requireTelemetryResource(undefined)).toThrow(
      "telemetry.resource with service.name is required",
    );
  });

  it("snapshots nested service identity and primitive-array attributes", () => {
    const zones = ["iad1"];
    const options = {
      resource: {
        service: { name: "dashboard", namespace: "hexclave" },
        attributes: { zones },
      },
    };
    const snapshot = snapshotTelemetryOptions(options);

    options.resource.service.name = "mutated";
    zones.push("sfo1");

    expect(snapshot?.resource).toEqual({
      service: { name: "dashboard", namespace: "hexclave" },
      attributes: { zones: ["iad1"] },
    });
  });

  it("omits waitUntil at the runtime serialization boundary", () => {
    const waitUntil = () => {};
    expect(telemetryOptionsToJson({
      resource: { service: { name: "api" } },
      waitUntil,
    })).toEqual({ resource: { service: { name: "api" } } });
  });
});
