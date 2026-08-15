import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { INTERNAL_COMPLETE_PATH_PREFIX, createFlyBuilder, createMockBuilder, verifyWebhookToken, type Builder } from "./builds.js";
import { MAX_UPLOAD_BYTES, MAX_WEBHOOK_BODY_BYTES, getConfig, resolveNamespaceOrg } from "./config.js";
import { attachDomain, detachDomain, normalizeHostnameOrThrow, readDomain } from "./domains.js";
import { MarshalError } from "./errors.js";
import { FlyApiError, flyClientForNamespaceOrg } from "./fly/client.js";
import { fetchLogPage } from "./logs.js";
import { MutationOutcomeUnknownError } from "./mutation-safety.js";
import { appNameForService } from "./naming.js";
import { ReconciliationLeaseLostError } from "./reconciliation-lock.js";
import {
  BUILD_ID_REGEX,
  advanceDeployment,
  applyServiceSpec,
  completeBuild,
  deleteService,
  deploymentLogRedactionValues,
  getServiceState,
  listServices,
  maybeFinalizeStaleDeployment,
  redactBuildLogText,
  startSourceDeployment,
  validateNamespace,
  validateServiceKey,
  validateServiceSpec,
  validateSourceId,
} from "./services.js";
import { createUploadSlot, readDeployment, readDeploymentLog } from "./store.js";
import type { LogLine } from "./types.js";

// How long after a build goes terminal its durable log object may still be missing before
// the logs route stops pretending the build is live. persistBuildLog runs BEFORE the terminal
// record on the completeBuild paths, so the only real window is maybeFinalizeStaleBuild
// (which writes the record first); past that, a missing object means the drain was empty or
// failed and no further lines are ever coming.
const DURABLE_LOG_GRACE_MS = 30 * 1000;

// Derived from the path the builder is actually given (buildCompletionPath) so the
// pre-handler auth gate and the route can never disagree — a mismatch rejects every real
// build's completion with a 404 that no test using the in-process mock builder would see.
// The prefix is path characters only, so it needs no regex escaping.
const INTERNAL_COMPLETE_PATH_REGEX = new RegExp(`^${INTERNAL_COMPLETE_PATH_PREFIX}([^/]+)/complete$`);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof MarshalError) {
    return jsonResponse(error.status, { error: error.code, message: error.message });
  }
  // Fencing outcomes: another reconciliation owns this service, or a Fly write's
  // outcome could not be established. Both are deliberately propagated by the
  // apply paths rather than swallowed, and neither is an internal fault — the
  // caller's move is to retry, so say that instead of "internal error" (which
  // the backend correctly escalates to an ISE).
  if (error instanceof ReconciliationLeaseLostError) {
    console.error("reconciliation fenced", error);
    return jsonResponse(409, { error: "reconciliation_conflict", message: "another reconciliation of this service is in progress; retry the request" });
  }
  if (error instanceof MutationOutcomeUnknownError) {
    // NOT 409: the write may well have landed, so this must not read as "nothing
    // happened, safely retry" — the state has to be re-read first.
    console.error("fly mutation outcome unknown", error);
    return jsonResponse(503, { error: "mutation_outcome_unknown", message: "a runtime mutation did not confirm; re-read the service state before retrying" });
  }
  if (error instanceof FlyApiError) {
    // Relay a sanitized upstream failure; Fly's own 4xxes on our requests are still OUR
    // bug or an infra failure from the caller's perspective, never theirs. The endpoint
    // (which embeds the Fly app name) stays in the server log only — never the response.
    console.error("fly API error", error);
    return jsonResponse(502, { error: "fly_api_error", message: `the Fly API rejected a request (${error.status})` });
  }
  console.error("unhandled marshal error", error);
  return jsonResponse(500, { error: "internal_error", message: "internal error" });
}

async function handle(fn: () => Promise<Response | Record<string, unknown>>): Promise<Response | Record<string, unknown>> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(error);
  }
}

function isAuthorized(header: string | null, apiKey: string): boolean {
  if (header === null) return false;
  const provided = Buffer.from(header, "utf8");
  const wanted = Buffer.from(`Bearer ${apiKey}`, "utf8");
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}


// Bounded at a safe integer AND at ~year 2255 in millis: the value is multiplied by 1e6 to
// form a nanosecond log cursor, so an unbounded number would produce exponential-notation
// (`1e+36`) tokens that break BigInt parsing downstream (and in the fly-mock).
const MAX_CURSOR_MILLIS = 9_000_000_000_000; // ~2255-01-01
function parseOptionalMillis(value: unknown): number | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_CURSOR_MILLIS ? parsed : undefined;
}

// Return type is inferred — Elysia's route-typed instances aren't assignable to the bare
// `Elysia` type, and nothing downstream needs the route types.
export function createMarshalApp() {
  const config = getConfig();
  const builder: Builder = config.builderKind === "mock" ? createMockBuilder(completeBuild) : createFlyBuilder();

  const app = new Elysia({ adapter: node() })
    .onRequest(({ request }) => {
      const url = new URL(request.url);
      // /health is the only unauthenticated surface.
      if (url.pathname === "/health") return;
      // /internal/deployments/* carries its own per-deployment HMAC token (the builder
      // machine never holds the backend credential), and it is authenticated HERE rather
      // than in the handler. Everything the token covers — deployment id, ns — is in the
      // URL, and the token is in a header, so nothing about this needs the body. Verifying
      // inside the handler instead meant Elysia had already buffered and parsed an arbitrary
      // body from an unauthenticated Internet client before the first credential check ran.
      //
      // The matcher, the route below and the URL the builder harness is given all derive
      // from INTERNAL_COMPLETE_PATH_PREFIX: a path this matcher does not recognize is
      // rejected here, so the handler never runs and no build can ever complete.
      if (url.pathname.startsWith("/internal/")) {
        const completeMatch = INTERNAL_COMPLETE_PATH_REGEX.exec(url.pathname);
        if (completeMatch === null) {
          // No other /internal route exists. Anything else under the prefix would otherwise
          // inherit the auth bypass without carrying a token of its own.
          return jsonResponse(404, { error: "not_found", message: "unknown internal route" });
        }
        // The webhook body is a small status/metadata document. Cap it before parsing so an
        // unauthenticated caller cannot make us allocate first and reject afterwards; the
        // large-body route (uploads) is a separate, API-key-authenticated path.
        //
        // A MISSING content-length is refused rather than treated as zero. This is the only
        // route reachable before any credential check, and a chunked request declares no
        // length — so `?? "0"` would let an unauthenticated client stream an unbounded body
        // that Elysia buffers before the cap could ever apply. The builder harness posts with
        // --post-file, which always declares a length, so nothing legitimate is refused here.
        const declaredLengthHeader = request.headers.get("content-length");
        const declaredLength = declaredLengthHeader === null ? null : Number(declaredLengthHeader);
        if (declaredLength === null || !Number.isInteger(declaredLength) || declaredLength < 0) {
          return jsonResponse(411, { error: "length_required", message: "build completion requests must declare a valid content-length" });
        }
        if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
          return jsonResponse(413, { error: "payload_too_large", message: `build completion body may not exceed ${MAX_WEBHOOK_BODY_BYTES} bytes` });
        }
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        const ns = url.searchParams.get("ns") ?? "";
        if (ns === "" || !verifyWebhookToken(token, completeMatch[1], ns)) {
          return jsonResponse(401, { error: "unauthenticated", message: "invalid webhook token" });
        }
        return;
      }
      if (!isAuthorized(request.headers.get("authorization"), config.apiKey)) {
        return jsonResponse(401, { error: "unauthenticated", message: "missing or invalid bearer credential" });
      }
    })
    .get("/health", () => ({ ok: true }))

    .post("/v1/namespaces/:ns/uploads", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const id = randomUUID();
      const slot = await createUploadSlot(ns, id);
      return jsonResponse(201, {
        id,
        upload_url: slot.uploadUrl,
        content_type: "application/gzip",
        expires_at_millis: slot.expiresAtMillis,
        max_bytes: MAX_UPLOAD_BYTES,
      });
    }))

    .get("/v1/namespaces/:ns", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      return { services: await listServices(ns) };
    }))

    .put("/v1/namespaces/:ns/services/:key", ({ params, body }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const key = validateServiceKey(params.key);
      const spec = validateServiceSpec(body);
      const result = await applyServiceSpec(ns, key, spec);
      return { revision: result.revision, changed: result.changed, state: result.state };
    }))

    .get("/v1/namespaces/:ns/services/:key", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const key = validateServiceKey(params.key);
      return await getServiceState(ns, key) as unknown as Record<string, unknown>;
    }))

    .delete("/v1/namespaces/:ns/services/:key", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const key = validateServiceKey(params.key);
      await deleteService(ns, key);
      return { deleted: true };
    }))

    // One `hexclave deploy` of one deployment source: build every target in one
    // machine, then apply them in the given dependency order.
    .post("/v1/namespaces/:ns/sources/:sourceId/deployments", ({ params, body }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const sourceId = validateSourceId(params.sourceId);
      return await startSourceDeployment(ns, sourceId, body, builder) as unknown as Record<string, unknown>;
    }))

    // Reading a deployment is also what ADVANCES it: there is no background
    // worker here, so each poll applies at most one more service (see
    // advanceDeployment).
    .get("/v1/namespaces/:ns/deployments/:id", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      if (!BUILD_ID_REGEX.test(params.id)) throw new MarshalError(400, "bad_request", "deployment id must be a ULID");
      return await advanceDeployment(ns, params.id) as unknown as Record<string, unknown>;
    }))

    .get("/v1/namespaces/:ns/deployments/:id/logs", ({ params, query }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      // Validate the id: it flows into an S3 object key, so a traversal id must not escape
      // the deployments/ prefix (defense in depth — the only caller passes a stored ULID).
      if (!BUILD_ID_REGEX.test(params.id)) throw new MarshalError(400, "bad_request", "deployment id must be a ULID");
      const deployment = await readDeployment(ns, params.id);
      if (deployment === null) throw new MarshalError(404, "not_found", `deployment ${JSON.stringify(params.id)} not found`);
      const checked = await maybeFinalizeStaleDeployment(deployment);
      const sinceMillis = parseOptionalMillis(query.since_millis);
      // The BUILD is what produces the log, so the log is complete once the build
      // is — not once the applies are, which follow it and print nothing here.
      const terminal = checked.status !== "building";

      if (!checked.has_logs) {
        return { lines: [], next_since_millis: sinceMillis ?? Date.now(), complete: true };
      }
      // A terminal deployment whose durable object never showed up must still end its
      // stream: the live proxy below is a best-effort last look, not an open-ended follow.
      // Without this the caller polls a finished build until its own timeout and is told the
      // build is "still running" the whole way.
      const liveIsFinal = terminal && Date.now() - (checked.finished_at_millis ?? checked.started_at_millis) > DURABLE_LOG_GRACE_MS;

      if (terminal) {
        // Durable path: the bucket log object written at finalization.
        const raw = await readDeploymentLog(ns, params.id);
        // No durable object yet (persist skipped an empty drain, or it's still being written
        // in the window right after the terminal record): fall through to the live proxy
        // rather than claiming a complete-but-empty log.
        if (raw !== null) {
          // One corrupt/truncated line must not 500 the whole request — skip it.
          const parseLine = (line: string): LogLine[] => {
            try {
              return [JSON.parse(line) as LogLine];
            } catch {
              return [];
            }
          };
          const lines: LogLine[] = raw
            .split("\n")
            .filter((line) => line !== "")
            .flatMap(parseLine)
            .filter((line) => sinceMillis === undefined || line.at_millis >= sinceMillis);
          const lastAtMillis = lines.length > 0 ? lines[lines.length - 1].at_millis : undefined;
          return { lines, next_since_millis: lastAtMillis !== undefined ? lastAtMillis + 1 : sinceMillis ?? Date.now(), complete: true };
        }
      }
      // Live path: proxy the builder machine's logs, scrubbing the credentials Marshal
      // handed to the build (stage 1 of the two-stage redaction).
      if (checked.builder_app === null || checked.builder_machine_id === null) {
        return { lines: [], next_since_millis: sinceMillis ?? checked.started_at_millis, complete: liveIsFinal };
      }
      const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
      const page = await fetchLogPage(fly, checked.builder_app, {
        sinceMillis: sinceMillis ?? checked.started_at_millis,
        instance: checked.builder_machine_id,
        forceNullInstance: true,
      });
      const redactionValues = deploymentLogRedactionValues(fly, checked);
      return {
        lines: page.lines.map((line) => ({ ...line, text: redactBuildLogText(line.text, redactionValues) })),
        next_since_millis: page.nextSinceMillis,
        complete: liveIsFinal,
      };
    }))

    .get("/v1/namespaces/:ns/services/:key/logs", ({ params, query }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const key = validateServiceKey(params.key);
      const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
      const page = await fetchLogPage(fly, appNameForService(getConfig().envId, ns, key), {
        sinceMillis: parseOptionalMillis(query.since_millis),
        instance: typeof query.instance === "string" && query.instance !== "" ? query.instance : undefined,
      });
      return { lines: page.lines, next_since_millis: page.nextSinceMillis };
    }))

    // Read-only: the "re-check verification now" primitive. A PUT would repoint the hostname,
    // so callers that only want current state must use this.
    .get("/v1/namespaces/:ns/domains/:hostname", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const hostname = normalizeHostnameOrThrow(params.hostname);
      return await readDomain(ns, hostname) as unknown as Record<string, unknown>;
    }))

    .put("/v1/namespaces/:ns/domains/:hostname", ({ params, body }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const hostname = normalizeHostnameOrThrow(params.hostname);
      const serviceKey = (body as Record<string, unknown> | null)?.service_key;
      if (typeof serviceKey !== "string") throw new MarshalError(400, "bad_request", "body must be { service_key }");
      return await attachDomain(ns, hostname, validateServiceKey(serviceKey)) as unknown as Record<string, unknown>;
    }))

    .delete("/v1/namespaces/:ns/domains/:hostname", ({ params, query }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const hostname = normalizeHostnameOrThrow(params.hostname);
      // Optional ownership fence — see detachDomain. Absent = detach whoever holds it.
      const expectedServiceKey = typeof query.service_key === "string" && query.service_key !== ""
        ? validateServiceKey(query.service_key)
        : undefined;
      await detachDomain(ns, hostname, expectedServiceKey);
      return { deleted: true };
    }))

    // Builder completion webhook. Auth: per-build HMAC token over (buildId, ns, key).
    // Body is buildctl's metadata JSON on success, or an error text on failure.
    // `parse: "text"` so a malformed/empty JSON body still reaches the handler (Elysia's
    // default JSON parser would 400 before it, making the registry-HEAD digest fallback
    // unreachable) — the handler parses defensively.
    .post(`${INTERNAL_COMPLETE_PATH_PREFIX}:deploymentId/complete`, ({ params, query, body, request }) => handle(async () => {
      const ns = typeof query.ns === "string" ? query.ns : "";
      const status = query.status === "succeeded" ? "succeeded" : query.status === "failed" ? "failed" : null;
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      if (ns === "" || status === null) throw new MarshalError(400, "bad_request", "ns and status query params are required");
      // Validate ns BEFORE trusting it: it flows into S3 keys inside completeBuild, and
      // possession of the webhook secret (which defaults to the API key) must not become an
      // arbitrary-key write primitive.
      validateNamespace(ns);
      // Re-verified here as well as in onRequest: onRequest is what stops an unauthenticated
      // body from being buffered, but this check is the one tied to the ns that completeBuild
      // actually writes with, after the validator above has run on it.
      if (!verifyWebhookToken(token, params.deploymentId, ns)) {
        return jsonResponse(401, { error: "unauthenticated", message: "invalid webhook token" });
      }
      if (!BUILD_ID_REGEX.test(params.deploymentId)) throw new MarshalError(400, "bad_request", "deployment id must be a ULID");
      const bodyText = typeof body === "string" ? body : body === null || body === undefined ? null : JSON.stringify(body);
      await completeBuild({
        ns,
        deploymentId: params.deploymentId,
        status,
        metadataJson: status === "succeeded" ? bodyText : null,
        errorText: status === "failed" ? bodyText : null,
      });
      return { ok: true };
    }), { parse: "text" });

  return { app, builder };
}
