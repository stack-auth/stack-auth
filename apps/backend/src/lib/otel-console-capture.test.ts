import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { context, TraceFlags, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { LoggerProvider, SimpleLogRecordProcessor, type LogRecordExporter, type ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installOtelConsoleCapture, OTEL_CONSOLE_SCOPE_NAME } from "./otel-console-capture";

class CollectingLogExporter implements LogRecordExporter {
  public readonly records: ReadableLogRecord[] = [];

  export(records: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    this.records.push(...records);
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  async shutdown(): Promise<void> {}
}

function setupGlobalLoggerProvider(exporter: LogRecordExporter): LoggerProvider {
  const provider = new LoggerProvider();
  provider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter));
  logs.setGlobalLoggerProvider(provider);
  return provider;
}

function summarize(record: ReadableLogRecord) {
  return {
    scope: record.instrumentationScope.name,
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body: record.body,
    attributes: record.attributes,
  };
}

describe("installOtelConsoleCapture", () => {
  afterEach(() => {
    // logs.disable() unregisters the global provider so one test's provider
    // can never receive another test's (or the test runner's) console output.
    logs.disable();
  });

  it("mirrors warnings into OTel log records and still calls the original", () => {
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    const originalSpy = vi.fn();
    const realConsoleWarn = console.warn;
    console.warn = originalSpy;
    const uninstall = installOtelConsoleCapture();
    try {
      console.warn("sign-in retry", { userId: "user-123", attempt: 2 });
    } finally {
      uninstall();
      console.warn = realConsoleWarn;
    }

    expect(originalSpy).toHaveBeenCalledTimes(1);
    expect(originalSpy).toHaveBeenCalledWith("sign-in retry", { userId: "user-123", attempt: 2 });
    expect(exporter.records.map(summarize)).toMatchInlineSnapshot(`
      [
        {
          "attributes": {
            "console_level": "warn",
          },
          "body": "sign-in retry {
        "attempt": 2,
        "userId": "user-123",
      }",
          "scope": "stack-backend-console",
          "severityNumber": 13,
          "severityText": "WARN",
        },
      ]
    `);
  });

  it("captures only warn and error console levels", () => {
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    const debugBefore = console.debug;
    const infoBefore = console.info;
    const uninstall = installOtelConsoleCapture();
    try {
      console.warn("w");
      console.error("e");
      expect(console.debug).toBe(debugBefore);
      expect(console.info).toBe(infoBefore);
    } finally {
      uninstall();
    }

    expect(exporter.records.map((record) => [record.body, record.severityNumber, record.severityText])).toMatchInlineSnapshot(`
      [
        [
          "w",
          13,
          "WARN",
        ],
        [
          "e",
          17,
          "ERROR",
        ],
      ]
    `);
    expect(exporter.records.every((record) => record.instrumentationScope.name === OTEL_CONSOLE_SCOPE_NAME)).toBe(true);
  });

  it("skips the SDK's own Hexclave-prefixed messages", () => {
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    const uninstall = installOtelConsoleCapture();
    try {
      console.warn("Hexclave analytics: something internal");
      console.warn("customer message");
    } finally {
      uninstall();
    }

    expect(exporter.records.map((record) => record.body)).toEqual(["customer message"]);
  });

  it("does not mirror console output produced while emitting (no feedback loop)", () => {
    // A SimpleLogRecordProcessor exports synchronously inside emit, so an
    // exporter that logs to console exercises exactly the recursion path the
    // re-entrancy guard exists for: without it, this test would loop forever.
    const records: ReadableLogRecord[] = [];
    const consoleLoggingExporter: LogRecordExporter = {
      export: (batch, resultCallback) => {
        records.push(...batch);
        console.warn("exporter internal chatter");
        resultCallback({ code: ExportResultCode.SUCCESS });
      },
      shutdown: async () => {},
    };
    setupGlobalLoggerProvider(consoleLoggingExporter);
    const uninstall = installOtelConsoleCapture();
    try {
      console.warn("outer message");
    } finally {
      uninstall();
    }

    expect(records.map((record) => record.body)).toEqual(["outer message"]);
  });

  it("truncates oversized bodies to the shared byte cap without splitting code points", () => {
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    const uninstall = installOtelConsoleCapture();
    try {
      // 3 bytes per char: 8192 / 3 is not an integer, so a naive slice at the
      // byte budget would land mid-code-point.
      console.warn("\u{20AC}".repeat(5_000));
    } finally {
      uninstall();
    }

    expect(exporter.records).toHaveLength(1);
    const body = exporter.records[0].body;
    if (typeof body !== "string") throw new Error("expected a string body");
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(8_192);
    expect(body).toMatch(/^\u{20AC}+$/u);
  });

  it("strips ANSI escape sequences from mirrored bodies but keeps bracketed text", () => {
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    const uninstall = installOtelConsoleCapture();
    try {
      // Next.js-style colored output: bold-white "○" followed by text.
      console.warn("\x1b[37m\x1b[1m○\x1b[22m\x1b[39m Compiling /api ...");
      console.warn("[Poller] Processed requests: 1");
    } finally {
      uninstall();
    }

    expect(exporter.records.map((record) => record.body)).toEqual([
      "○ Compiling /api ...",
      "[Poller] Processed requests: 1",
    ]);
  });

  it("restores the original console methods on uninstall", () => {
    const before = console.warn;
    const uninstall = installOtelConsoleCapture();
    expect(console.warn).not.toBe(before);
    uninstall();
    // The patch binds the original, so identity with `before` is not
    // guaranteed — but calling the restored method must not emit records.
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    console.warn("after uninstall");
    expect(exporter.records).toHaveLength(0);
  });

  it("attaches the active parent span and promotes error-log traces", () => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    const exporter = new CollectingLogExporter();
    setupGlobalLoggerProvider(exporter);
    const promotedTraceIds: string[] = [];
    const uninstall = installOtelConsoleCapture({
      onErrorTrace: (traceId) => promotedTraceIds.push(traceId),
    });
    const spanContext = {
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: TraceFlags.NONE,
      isRemote: false,
    };
    try {
      context.with(trace.setSpanContext(context.active(), spanContext), () => {
        console.warn("correlated warning");
        console.error("correlated failure");
      });
    } finally {
      uninstall();
      context.disable();
    }

    expect({
      records: exporter.records.map((record) => ({
        body: record.body,
        traceId: record.spanContext?.traceId,
        spanId: record.spanContext?.spanId,
      })),
      promotedTraceIds,
    }).toMatchInlineSnapshot(`
      {
        "promotedTraceIds": [
          "11111111111111111111111111111111",
        ],
        "records": [
          {
            "body": "correlated warning",
            "spanId": "2222222222222222",
            "traceId": "11111111111111111111111111111111",
          },
          {
            "body": "correlated failure",
            "spanId": "2222222222222222",
            "traceId": "11111111111111111111111111111111",
          },
        ],
      }
    `);
  });
});
