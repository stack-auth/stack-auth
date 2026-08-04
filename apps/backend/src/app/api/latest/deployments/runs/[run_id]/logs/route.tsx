import { decryptDeploymentRedactionSecrets, isTerminalRunStatus, marshalNamespaceForTenancy, redactSecrets, refreshRunFromMarshal } from "@/lib/deployments";
import { getMarshalClientOrThrow } from "@/lib/deployments/marshal-client";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupMixed, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";

// The stream pages build logs from Marshal until the build finishes, capped so
// a stuck build can't hold the connection forever. Clients can simply
// re-request to resume (the whole log is replayed each time — build logs are
// small).
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
      include: { service: true },
    });
    if (run == null) {
      throw new StatusError(404, "No deployment run found with the given id.");
    }
    // Refresh first: a run created before its build started (blocked, or a post-PUT lookup
    // failure) has marshalBuildId=null even though a build may be running now —
    // refreshRunFromMarshal attaches it by revision. Without this, an actively-building run
    // would get a bare 400 "no build logs" until the caller happened to hit GET /runs first.
    try {
      await refreshRunFromMarshal(prisma, auth.tenancy, run, run.service.serviceId);
    } catch (e) {
      captureError("deployments-run-logs-refresh", e);
    }
    const refreshedRun = await prisma.deploymentRun.findUnique({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: params.run_id } },
    });
    const marshalBuildId = refreshedRun?.marshalBuildId ?? null;
    if (marshalBuildId == null) {
      // A blocked/errored run that never produced a build gets a clearer message than a
      // still-building one.
      throw new StatusError(400, isTerminalRunStatus(refreshedRun?.status ?? run.status)
        ? "This run produced no build (it failed before a build started, e.g. blocked on an unresolved connection)."
        : "This run has no build logs yet.");
    }
    const serviceId = run.service.serviceId;
    const client = getMarshalClientOrThrow();
    const ns = marshalNamespaceForTenancy(auth.tenancy);

    // Builds run user code that may print env values. Use the exact encrypted
    // snapshot captured for THIS run: current project secrets cannot cover
    // request-only defaults or values that were rotated/deleted afterwards.
    // Decryption and validation happen before the response starts, so any
    // failure closes the endpoint rather than serving partially-redacted logs.
    // (Marshal applies its own stage-1 redaction of runtime credentials; this
    // is stage 2, covering the backend's secrets.)
    const secretValues = await decryptDeploymentRedactionSecrets(run.redactionSecretsEncrypted);

    const encoder = new TextEncoder();
    // Flipped by cancel() when the client disconnects: the poll loop must stop
    // hitting Marshal, and a disconnect is NOT an error worth capturing.
    let clientCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          const startedAt = performance.now();
          let sinceMillis: number | undefined = undefined;
          while (!clientCancelled) {
            const page = await client.getBuildLogs(ns, serviceId, marshalBuildId, { sinceMillis });
            for (const line of page.lines) {
              const text = redactSecrets(line.text, secretValues);
              controller.enqueue(encoder.encode(text.endsWith("\n") ? text : `${text}\n`));
            }
            // Guard a non-advancing cursor (a bug or a bogus next_since_millis) from becoming
            // a hot loop that re-enqueues the same window until MAX_STREAM_MS. The cursor is
            // also kept strictly monotonic: out-of-order log timestamps can make Marshal hand
            // back a LOWER next_since_millis, and storing that verbatim would re-emit the same
            // lines on every poll instead of making forward progress.
            // Both annotated: `sinceMillis` feeds the getBuildLogs call above, so letting TS
            // infer either of these through the assignment below is a circular reference.
            const previousSinceMillis: number | undefined = sinceMillis;
            const cursorAdvanced: boolean = previousSinceMillis === undefined || page.next_since_millis > previousSinceMillis;
            const nextSinceMillis: number = cursorAdvanced ? page.next_since_millis : (previousSinceMillis ?? page.next_since_millis) + 1;
            sinceMillis = nextSinceMillis;

            if (page.complete) {
              break;
            }
            if (performance.now() - startedAt > MAX_STREAM_MS) {
              controller.enqueue(encoder.encode("[hexclave] Log stream timed out while the build is still running; re-request to continue following.\n"));
              break;
            }
            // Sleep whenever the build isn't complete — not only on an empty page. A chatty
            // build returns lines every page, and hammering Marshal (→ Fly's logs API) with
            // zero delay for the whole window is needless load.
            if (page.lines.length === 0 || !cursorAdvanced) {
              await wait(POLL_INTERVAL_MS);
            } else {
              await wait(Math.min(POLL_INTERVAL_MS, 500));
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
