import type { Attributes, Gauge, Meter, MetricOptions } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { OtlpWebVitalsMetricRecorder } from "./web-vitals";

class FakeGauge implements Pick<Gauge, "record"> {
  constructor(
    private readonly name: string,
    private readonly values: Map<string, { value: number, attributes: Attributes }[]>,
  ) {}

  record(value: number, attributes: Attributes = {}): void {
    const entries = this.values.get(this.name) ?? [];
    entries.push({ value, attributes });
    this.values.set(this.name, entries);
  }
}

class FakeMeter implements Pick<Meter, "createGauge"> {
  readonly values = new Map<string, { value: number, attributes: Attributes }[]>();

  createGauge(name: string, _options?: MetricOptions): Gauge {
    return new FakeGauge(name, this.values);
  }
}

describe("OtlpWebVitalsMetricRecorder", () => {
  it("records finite browser samples as native gauge observations with navigation scope", () => {
    const meter = new FakeMeter();
    const recorder = new OtlpWebVitalsMetricRecorder(meter);

    recorder.record({ lcp_ms: 1234, cls: 0.04, fps: Infinity, soft_nav: 1 });

    expect(meter.values.get("hexclave.web.vitals.lcp")).toEqual([{
      value: 1234,
      attributes: { "hexclave.web.vitals.navigation": "soft" },
    }]);
    expect(meter.values.get("hexclave.web.vitals.cls")).toEqual([{
      value: 0.04,
      attributes: { "hexclave.web.vitals.navigation": "soft" },
    }]);
    expect(meter.values.has("hexclave.web.vitals.fps")).toBe(false);
  });
});
