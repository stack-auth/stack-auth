import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const backendDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

it("exports spans from Sentry's provider to an OTLP HTTP collector", async () => {
  const exportRequests: { byteLength: number, method: string | undefined, url: string | undefined }[] = [];
  const collector = createServer((request, response) => {
    let byteLength = 0;
    request.on("data", (chunk: Buffer) => {
      byteLength += chunk.byteLength;
    });
    request.on("end", () => {
      exportRequests.push({
        byteLength,
        method: request.method,
        url: request.url,
      });
      response.writeHead(200);
      response.end();
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error);
    collector.once("error", onError);
    collector.listen(0, "127.0.0.1", () => {
      collector.off("error", onError);
      resolveListen();
    });
  });

  try {
    const address = collector.address();
    if (address == null || typeof address === "string") {
      throw new Error("The test OTLP collector must listen on a TCP port");
    }

    await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      `
        import { trace } from "@opentelemetry/api";
        import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
        import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
        import * as Sentry from "@sentry/node";

        const endpoint = process.env.TEST_OTLP_ENDPOINT;
        if (endpoint == null) throw new Error("TEST_OTLP_ENDPOINT is required");
        Sentry.init({
          enabled: false,
          openTelemetrySpanProcessors: [
            new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint })),
          ],
          registerEsmLoaderHooks: false,
          tracesSampleRate: 1,
        });
        const span = trace.getTracer("otel-export-test").startSpan("export-test-span");
        span.end();
        if (!await Sentry.close(5_000)) throw new Error("Sentry did not flush the OTLP exporter");
      `,
    ], {
      cwd: backendDirectory,
      env: {
        NODE_ENV: "test",
        TEST_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}/v1/traces`,
      },
    });

    expect(exportRequests).toMatchObject([{
      byteLength: expect.any(Number),
      method: "POST",
      url: "/v1/traces",
    }]);
    expect(exportRequests[0]?.byteLength).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      collector.close((error) => error == null ? resolveClose() : rejectClose(error));
    });
  }
}, 10_000);
