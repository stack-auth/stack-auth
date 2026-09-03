import { describe, expect, it } from "vitest";
import { telemetryMeteredAt } from "./telemetry-metering-time";

describe("telemetryMeteredAt", () => {
  const receivedAt = new Date("2026-08-20T12:00:00.000Z");

  it("uses valid client time but never assigns usage to the future", () => {
    expect(telemetryMeteredAt("2026-08-19T12:00:00.000Z", 0, receivedAt)).toEqual(new Date("2026-08-19T12:00:00.000Z"));
    expect(telemetryMeteredAt("2099-01-01T00:00:00.000Z", 0, receivedAt)).toEqual(receivedAt);
  });

  it("falls back for malformed and out-of-range timestamps", () => {
    const fallback = Date.parse("2026-08-18T12:00:00.000Z");
    expect(telemetryMeteredAt("not-a-date", fallback, receivedAt)).toEqual(new Date(fallback));
    expect(telemetryMeteredAt(Number.POSITIVE_INFINITY, fallback, receivedAt)).toEqual(new Date(fallback));
  });
});
