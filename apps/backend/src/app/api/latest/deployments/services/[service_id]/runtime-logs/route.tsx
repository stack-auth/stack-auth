import { collectLogRedactionSecrets, getServiceDefinitionOrThrow, redactSecrets } from "@/lib/deployments";
import { getVercelDeploymentsClientOrThrow, sanitizeVercelError } from "@/lib/deployments/vercel-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, userSpecifiedIdSchema, yupMixed, yupObject } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

// Vercel holds the upstream runtime-log connection for up to ~5 minutes; we
// cut slightly earlier so our own response always terminates cleanly.
const MAX_STREAM_MS = 4 * 60 * 1000;

// Formats one NDJSON runtime-log event from Vercel into a display line. The
// shape is only loosely guaranteed, so read every field defensively and fall
// back to the raw line for anything unparseable.
function formatRuntimeLogLine(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed === "") return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  const timestampMs = typeof parsed?.timestampInMs === "number" ? parsed.timestampInMs : (typeof parsed?.timestamp === "number" ? parsed.timestamp : null);
  const timestamp = timestampMs != null ? new Date(timestampMs).toISOString() : null;
  const level = typeof parsed?.level === "string" ? parsed.level : "info";
  const message = typeof parsed?.message === "string" ? parsed.message : trimmed;
  return `${timestamp != null ? `${timestamp} ` : ""}[${level}] ${message}`;
}

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Stream deployment service runtime logs",
    description: "Live-tails the runtime logs of the service's latest deployment as chunked plain text. Only logs for traffic that happens while the stream is open are emitted (the deployment target keeps no readable history); the stream ends after a few minutes — re-request to keep tailing.",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      service_id: userSpecifiedIdSchema("serviceId").defined(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  handler: async ({ auth, params }) => {
    getServiceDefinitionOrThrow(auth.tenancy, params.service_id);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const service = await prisma.deploymentService.findUnique({
      where: {
        tenancyId_serviceId: {
          tenancyId: auth.tenancy.id,
          serviceId: params.service_id,
        },
      },
    });
    if (service?.vercelProjectId == null) {
      throw new StatusError(400, "This service has not been deployed yet, so there are no runtime logs.");
    }
    // Runtime logs attach to a specific deployment; tail the newest one that
    // actually reached the target (prefer the latest READY production deploy).
    const latestReadyRun = await prisma.deploymentRun.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        deploymentServiceId: service.id,
        status: "READY",
        target: "production",
        vercelDeploymentId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    const vercelDeploymentId = latestReadyRun?.vercelDeploymentId;
    if (vercelDeploymentId == null) {
      throw new StatusError(400, "This service has no successful deployment yet, so there are no runtime logs.");
    }

    const client = getVercelDeploymentsClientOrThrow();
    const secretValues = await collectLogRedactionSecrets({
      tenancy: auth.tenancy,
    });

    let upstream;
    try {
      upstream = await client.fetchRuntimeLogsStream(service.vercelProjectId, vercelDeploymentId);
    } catch (e) {
      sanitizeVercelError(e, "Opening the runtime log stream failed");
    }
    const upstreamBody = upstream.body;
    if (upstreamBody == null) {
      throw new StatusError(400, "The deployment target returned no runtime log stream.");
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstreamBody.getReader();
    // Flipped by cancel() when the client disconnects — the normal way a live
    // tail ends. After that the controller is unusable and nothing here is an
    // error worth capturing.
    let clientCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const startedAt = performance.now();
        let lineBuffer = "";
        const emitLine = (rawLine: string) => {
          const formatted = formatRuntimeLogLine(rawLine);
          if (formatted != null) {
            controller.enqueue(encoder.encode(`${redactSecrets(formatted, secretValues)}\n`));
          }
        };
        try {
          while (performance.now() - startedAt < MAX_STREAM_MS) {
            const { done, value } = await reader.read();
            if (clientCancelled) return;
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? "";
            for (const line of lines) {
              emitLine(line);
            }
          }
          emitLine(lineBuffer);
          controller.close();
        } catch (error) {
          if (clientCancelled) {
            return;
          }
          // The 200 is already out the door; log server-side and end the
          // stream with a marker that leaks nothing.
          captureError("deployment-runtime-log-stream", error);
          try {
            controller.enqueue(encoder.encode("[hexclave] Runtime log stream ended unexpectedly.\n"));
            controller.close();
          } catch {
            // Controller may already be closed/errored; nothing left to do.
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            // Upstream may already be closed; cancellation is best-effort.
          }
        }
      },
      cancel: async () => {
        // Client went away (e.g. the Logs tab was closed): stop tailing Vercel.
        clientCancelled = true;
        try {
          await reader.cancel();
        } catch {
          // Upstream may already be closed; cancellation is best-effort.
        }
      },
    });

    return {
      statusCode: 200,
      bodyType: "response" as const,
      body: new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      }),
    };
  },
});
