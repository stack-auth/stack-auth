import { context, TraceFlags, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { Resource } from "@opentelemetry/resources";
import { LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { describe, expect, it } from "vitest";
import { AnalyticsLogExporter, severityNumberToLevel } from "./self-telemetry-log-exporter";
import type { AnalyticsLogRow } from "./self-telemetry-logs";

describe("AnalyticsLogExporter", () => {
  it("writes backend log records into the native Analytics event shape", async () => {
    const written: AnalyticsLogRow[] = [];
    const exporter = new AnalyticsLogExporter(async (logs) => {
      written.push(...logs);
    });
    const provider = new LoggerProvider({
      resource: new Resource({
        "service.namespace": "hexclave",
        "service.name": "backend-test",
        "deployment.environment.name": "test",
      }),
    });
    provider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter));
    const logger = provider.getLogger("self-telemetry-log-exporter-test", "1.0.0");
    const spanContext = {
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };

    logger.emit({
      timestamp: new Date(1_753_228_800_123),
      observedTimestamp: new Date(1_753_228_800_456),
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: {
        message: "checkout failed",
        retryable: false,
      },
      attributes: {
        "order.id": "order-123",
        attempts: 2,
      },
      context: trace.setSpanContext(context.active(), spanContext),
    });

    await provider.forceFlush();
    expect(written).toMatchInlineSnapshot(`
      [
        {
          "data": {
            "attempts": 2,
            "order.id": "order-123",
          },
          "deployment_environment_name": "test",
          "event_at": 2025-07-23T00:00:00.123Z,
          "event_type": "$log",
          "level": "error",
          "message": "{"message":"checkout failed","retryable":false}",
          "parent_span_ids": [
            "2222222222222222",
          ],
          "producer": "hexclave-backend",
          "service_name": "backend-test",
          "span_id": "2222222222222222",
          "trace_id": "11111111111111111111111111111111",
        },
      ]
    `);

    await provider.shutdown();
  });

  it("exports only warn and error records even from direct OTel emitters", async () => {
    const written: AnalyticsLogRow[] = [];
    const exporter = new AnalyticsLogExporter(async (logs) => {
      written.push(...logs);
    });
    const provider = new LoggerProvider({ resource: new Resource({}) });
    provider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter));
    const logger = provider.getLogger("levels-test");
    logger.emit({ severityNumber: SeverityNumber.DEBUG, body: "verbose" });
    logger.emit({ severityNumber: SeverityNumber.INFO, body: "routine" });
    logger.emit({ severityNumber: SeverityNumber.WARN, body: "careful" });
    logger.emit({ severityNumber: SeverityNumber.ERROR, body: "failed" });
    await provider.forceFlush();
    expect(written.map((row) => [row.message, row.level])).toEqual([
      ["careful", "warn"],
      ["failed", "error"],
    ]);
    await provider.shutdown();
  });
});

describe("severityNumberToLevel", () => {
  it("buckets the 1-24 severity scale into the five product levels", () => {
    // 0/unspecified deliberately lands on info: a level-less record must show
    // up in the default Logs view rather than hide behind a trace filter.
    expect(severityNumberToLevel(undefined)).toBe("info");
    expect(severityNumberToLevel(0)).toBe("info");
    expect(severityNumberToLevel(1)).toBe("trace");
    expect(severityNumberToLevel(4)).toBe("trace");
    expect(severityNumberToLevel(5)).toBe("debug");
    expect(severityNumberToLevel(8)).toBe("debug");
    expect(severityNumberToLevel(9)).toBe("info");
    expect(severityNumberToLevel(12)).toBe("info");
    expect(severityNumberToLevel(13)).toBe("warn");
    expect(severityNumberToLevel(16)).toBe("warn");
    expect(severityNumberToLevel(17)).toBe("error");
    expect(severityNumberToLevel(24)).toBe("error");
  });
});
