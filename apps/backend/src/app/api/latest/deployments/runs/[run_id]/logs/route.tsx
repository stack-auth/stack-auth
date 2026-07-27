import { collectLogRedactionSecrets, isTerminalRunStatus, mapVercelReadyState, redactSecrets } from "@/lib/deployments";
import { getVercelDeploymentsClientOrThrow, sanitizeVercelError } from "@/lib/deployments/vercel-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";

// The stream polls Vercel until the build finishes, capped so a stuck build
// can't hold the connection forever. Clients can simply re-request to resume
// (the whole log is replayed each time — build logs are small).
const POLL_INTERVAL_MS = 2000;
const MAX_STREAM_MS = 4 * 60 * 1000;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Stream deployment run logs",
    description: "Streams the build logs of a deployment run as chunked plain text. Replays all logs from the start, then follows until the run reaches a terminal state (or a few minutes pass — re-request to continue following).",
    tags: ["Deployments"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      run_id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupMixed<SmartResponse>().defined(),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const run = await prisma.deploymentRun.findUnique({
      where: {
        tenancyId_id: {
          tenancyId: auth.tenancy.id,
          id: params.run_id,
        },
      },
    });
    if (run == null) {
      throw new StatusError(404, "No deployment run found with the given id.");
    }
    const vercelDeploymentId = run.vercelDeploymentId;
    if (vercelDeploymentId == null) {
      throw new StatusError(400, "This run has no build logs.");
    }
    const client = getVercelDeploymentsClientOrThrow();

    // Builds run user code that may print env values, so redact everything we
    // know to be secret (see collectLogRedactionSecrets).
    const secretValues = await collectLogRedactionSecrets({
      tenancy: auth.tenancy,
    });

    const encoder = new TextEncoder();
    let isRunTerminal = isTerminalRunStatus(run.status);
    // Flipped by cancel() when the client disconnects: the poll loop must stop
    // hitting Vercel, and a disconnect is NOT an error worth capturing.
    let clientCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          const startedAt = performance.now();
          let emittedCount = 0;
          while (!clientCancelled) {
            let events;
            try {
              events = await client.getDeploymentEvents(vercelDeploymentId);
            } catch (e) {
              sanitizeVercelError(e, "Fetching build logs failed");
            }
            for (const event of events.slice(emittedCount)) {
              const text = redactSecrets(event.text, secretValues);
              controller.enqueue(encoder.encode(text.endsWith("\n") ? text : `${text}\n`));
            }
            // Monotonic: a transient empty/miss-shaped events response must
            // not reset the counter, or the next full response would replay
            // every line again.
            emittedCount = Math.max(emittedCount, events.length);

            if (isRunTerminal) {
              break;
            }
            if (performance.now() - startedAt > MAX_STREAM_MS) {
              controller.enqueue(encoder.encode("[hexclave] Log stream timed out while the build is still running; re-request to continue following.\n"));
              break;
            }
            let deployment;
            try {
              deployment = await client.getDeployment(vercelDeploymentId);
            } catch (e) {
              sanitizeVercelError(e, "Fetching the deployment status failed");
            }
            isRunTerminal = isTerminalRunStatus(mapVercelReadyState(deployment.readyState));
            if (!isRunTerminal) {
              await wait(POLL_INTERVAL_MS);
            }
          }
          if (!clientCancelled) {
            controller.close();
          }
        } catch (error) {
          if (clientCancelled) {
            // Enqueueing after the client went away throws; that's the normal
            // disconnect path, not an error.
            return;
          }
          // The stream has already started (status 200 is out the door), so
          // all we can do is log server-side and end the stream with a
          // generic marker that leaks nothing.
          captureError("deployment-run-log-stream", error);
          try {
            controller.enqueue(encoder.encode("[hexclave] Log stream ended unexpectedly.\n"));
            controller.close();
          } catch {
            // Controller may already be closed/errored; nothing left to do.
          }
        }
      },
      cancel: () => {
        clientCancelled = true;
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
