import { describe, expect, it, vi } from "vitest";
import {
  CompositeDashboardTraceExporter,
  createAnalyticsTraceExporterConfig,
  type DashboardTraceExporter,
} from "./dashboard-trace-export";

function createFakeExporter(resultCode: number) {
  const exportSpans = vi.fn((
    _spans: Parameters<DashboardTraceExporter["export"]>[0],
    callback: Parameters<DashboardTraceExporter["export"]>[1],
  ) => {
    callback({ code: resultCode });
  });
  const forceFlush = vi.fn(async () => {});
  const shutdown = vi.fn(async () => {});
  return {
    exporter: {
      export: exportSpans,
      forceFlush,
      shutdown,
    },
    export: exportSpans,
    forceFlush,
    shutdown,
  };
}

describe("dashboard trace export", () => {
  it("builds an authenticated OTLP endpoint for the configured project", () => {
    expect(createAnalyticsTraceExporterConfig({
      apiUrl: "https://api.example.com/base",
      projectId: "internal",
      secretServerKey: "server-key",
    })).toMatchInlineSnapshot(`
      {
        "headers": {
          "x-hexclave-access-type": "server",
          "x-hexclave-project-id": "internal",
          "x-hexclave-secret-server-key": "server-key",
        },
        "url": "https://api.example.com/api/v1/analytics/otlp/v1/traces",
      }
    `);
  });

  it("exports to every sink and reports a failed sink", async () => {
    const successful = createFakeExporter(0);
    const failed = createFakeExporter(1);
    const exporter = new CompositeDashboardTraceExporter([
      successful.exporter,
      failed.exporter,
    ]);
    const callback = vi.fn();

    exporter.export([], callback);
    await exporter.forceFlush();
    await exporter.shutdown();

    expect(successful.export).toHaveBeenCalledOnce();
    expect(failed.export).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({ code: 1 });
    expect(successful.forceFlush).toHaveBeenCalledOnce();
    expect(failed.forceFlush).toHaveBeenCalledOnce();
    expect(successful.shutdown).toHaveBeenCalledOnce();
    expect(failed.shutdown).toHaveBeenCalledOnce();
  });
});
