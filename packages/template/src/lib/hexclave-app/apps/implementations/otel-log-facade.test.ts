import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { afterEach, describe, expect, it } from "vitest";
import { emitHexclaveOtelError, emitHexclaveOtelEvent, emitHexclaveOtelLog } from "./otel-log-facade";

const providers: LoggerProvider[] = [];

afterEach(async () => {
  logs.disable();
  await Promise.all(providers.splice(0).map(async (provider) => await provider.shutdown()));
});

describe("emitHexclaveOtelLog", () => {
  it("emits a correlated OTel LogRecord without a legacy batch payload", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter })],
    });
    providers.push(provider);
    expect(logs.setGlobalLoggerProvider(provider)).toBe(provider);

    emitHexclaveOtelLog({
      message: "checkout failed",
      level: "error",
      data: { attempt: 2, nested: { retryable: true } },
      origin: "logger",
    }, "test-version");
    await provider.forceFlush();

    expect(exporter.getFinishedLogRecords()).toMatchObject([{
      instrumentationScope: { name: "hexclave.sdk", version: "test-version" },
      eventName: "$log",
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "checkout failed",
      attributes: {
        "hexclave.signal.type": "log",
        "hexclave.data": { attempt: 2, nested: { retryable: true } },
      },
    }]);
  });

  it("emits product events as named OTel LogRecords with explicit parent context", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    providers.push(provider);
    logs.setGlobalLoggerProvider(provider);

    emitHexclaveOtelEvent({
      eventName: "checkout-completed",
      data: { total: 42 },
      clientVersion: "test-version",
      parent: { traceId: "11111111111111111111111111111111", spanId: "2222222222222222", traceState: "vendor=value" },
      correlationAttributes: { "hexclave.session_replay.segment.id": "segment" },
    });
    await provider.forceFlush();

    expect(exporter.getFinishedLogRecords()).toMatchObject([{
      eventName: "checkout-completed",
      attributes: {
        "hexclave.signal.type": "event",
        "hexclave.data": { total: 42 },
        "hexclave.session_replay.segment.id": "segment",
      },
      spanContext: {
        traceId: "11111111111111111111111111111111",
        spanId: "2222222222222222",
      },
    }]);
  });

  it("emits automatic errors as standard error-severity LogRecords", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] });
    providers.push(provider);
    logs.setGlobalLoggerProvider(provider);
    emitHexclaveOtelError({
      data: { name: "PaymentError", message: "card declined", handled: false },
      clientVersion: "test-version",
      parent: null,
    });
    await provider.forceFlush();
    expect(exporter.getFinishedLogRecords()).toMatchObject([{
      eventName: "$error",
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "card declined",
      attributes: {
        "hexclave.signal.type": "error",
        "hexclave.data": { name: "PaymentError", message: "card declined", handled: false },
      },
    }]);
  });
});
