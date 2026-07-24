import {
  OTLPHttpJsonTraceExporter,
} from "@vercel/otel";

export type DashboardTraceExporter = Pick<
  OTLPHttpJsonTraceExporter,
  "export" | "forceFlush" | "shutdown"
>;

type DashboardTraceExportResult = Parameters<
  Parameters<DashboardTraceExporter["export"]>[1]
>[0];

export function createAnalyticsTraceExporterConfig(options: {
  apiUrl: string,
  projectId: string,
  secretServerKey: string,
}): {
  url: string,
  headers: Record<string, string>,
} {
  return {
    url: new URL("/api/v1/analytics/otlp/v1/traces", options.apiUrl).toString(),
    headers: {
      "x-hexclave-access-type": "server",
      "x-hexclave-project-id": options.projectId,
      "x-hexclave-secret-server-key": options.secretServerKey,
    },
  };
}

/**
 * Fans completed spans out to every configured sink. Returning the highest
 * OpenTelemetry result code ensures a failed Analytics write is not hidden by
 * a successful development-observability export (or vice versa).
 */
export class CompositeDashboardTraceExporter implements DashboardTraceExporter {
  constructor(
    private readonly exporters: readonly [
      DashboardTraceExporter,
      DashboardTraceExporter,
      ...DashboardTraceExporter[],
    ],
  ) {}

  export(
    spans: Parameters<DashboardTraceExporter["export"]>[0],
    resultCallback: Parameters<DashboardTraceExporter["export"]>[1],
  ): void {
    let remaining = this.exporters.length;
    const results: DashboardTraceExportResult[] = [];

    for (const exporter of this.exporters) {
      exporter.export(spans, (result) => {
        results.push(result);
        remaining -= 1;
        if (remaining === 0) {
          resultCallback(results.reduce((worstResult, currentResult) => (
            currentResult.code > worstResult.code ? currentResult : worstResult
          )));
        }
      });
    }
  }

  async forceFlush(): Promise<void> {
    await Promise.all(this.exporters.map((exporter) => exporter.forceFlush()));
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.exporters.map((exporter) => exporter.shutdown()));
  }
}
