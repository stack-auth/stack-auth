import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createFlyBuilder, createMockBuilder, verifyWebhookToken, type Builder } from "./builds.js";
import { MAX_UPLOAD_BYTES, getConfig, resolveNamespaceOrg } from "./config.js";
import { attachDomain, detachDomain, normalizeHostnameOrThrow } from "./domains.js";
import { MarshalError } from "./errors.js";
import { FlyApiError, flyClientForNamespaceOrg } from "./fly/client.js";
import { fetchLogPage } from "./logs.js";
import { appNameForService } from "./naming.js";
import {
  BUILD_ID_REGEX,
  applyServiceSpec,
  buildLogRedactionValues,
  completeBuild,
  deleteService,
  getServiceState,
  listServiceBuilds,
  listServices,
  maybeFinalizeStaleBuild,
  redactBuildLogText,
  validateNamespace,
  validateServiceKey,
  validateServiceSpec,
} from "./services.js";
import { createUploadSlot, readBuild, readBuildLog } from "./store.js";
import type { Build, LogLine, StoredBuild } from "./types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(error: unknown): Response {
  if (error instanceof MarshalError) {
    return jsonResponse(error.status, { error: error.code, message: error.message });
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

function buildToApi(build: StoredBuild): Build {
  return {
    id: build.id,
    revision: build.revision,
    status: build.status,
    has_logs: build.has_logs,
    error: build.error,
    started_at_millis: build.started_at_millis,
    finished_at_millis: build.finished_at_millis,
  };
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
      // /health is the only unauthenticated surface; /internal/builds/* carries its own
      // per-build HMAC token (the builder machine never holds the backend credential).
      if (url.pathname === "/health" || url.pathname.startsWith("/internal/")) return;
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
      const result = await applyServiceSpec(ns, key, spec, builder);
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

    .get("/v1/namespaces/:ns/services/:key/builds", ({ params, query }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const key = validateServiceKey(params.key);
      const limit = Math.max(1, Math.min(100, Number(typeof query.limit === "string" && query.limit !== "" ? query.limit : "20") || 20));
      const builds = await listServiceBuilds(ns, key, { limit, beforeMillis: parseOptionalMillis(query.before_millis) });
      return { builds: builds.map(buildToApi) };
    }))

    .get("/v1/namespaces/:ns/services/:key/builds/:id/logs", ({ params, query }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const key = validateServiceKey(params.key);
      // Validate the build id: it flows into an S3 object key, so a traversal id must not
      // escape the builds/ prefix (defense in depth — the only caller passes a DB ULID).
      if (!BUILD_ID_REGEX.test(params.id)) throw new MarshalError(400, "bad_request", "build id must be a ULID");
      const build = await readBuild(ns, key, params.id);
      if (build === null) throw new MarshalError(404, "not_found", `build ${JSON.stringify(params.id)} not found`);
      const checked = await maybeFinalizeStaleBuild(build);
      const sinceMillis = parseOptionalMillis(query.since_millis);
      const terminal = checked.status !== "queued" && checked.status !== "running";

      if (!checked.has_logs) {
        return { lines: [], next_since_millis: sinceMillis ?? Date.now(), complete: true };
      }
      if (terminal) {
        // Durable path: the bucket log object written at finalization.
        const raw = await readBuildLog(ns, key, params.id);
        // No durable object yet (persist skipped an empty drain, or it's still being written
        // in the window right after the terminal record): report complete:false and fall
        // through to the live proxy rather than claiming a complete-but-empty log.
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
        return { lines: [], next_since_millis: sinceMillis ?? checked.started_at_millis, complete: false };
      }
      const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
      const page = await fetchLogPage(fly, checked.builder_app, {
        sinceMillis: sinceMillis ?? checked.started_at_millis,
        instance: checked.builder_machine_id,
        forceNullInstance: true,
      });
      const redactionValues = buildLogRedactionValues(fly, checked);
      return {
        lines: page.lines.map((line) => ({ ...line, text: redactBuildLogText(line.text, redactionValues) })),
        next_since_millis: page.nextSinceMillis,
        complete: false,
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

    .put("/v1/namespaces/:ns/domains/:hostname", ({ params, body }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const hostname = normalizeHostnameOrThrow(params.hostname);
      const serviceKey = (body as Record<string, unknown> | null)?.service_key;
      if (typeof serviceKey !== "string") throw new MarshalError(400, "bad_request", "body must be { service_key }");
      return await attachDomain(ns, hostname, validateServiceKey(serviceKey)) as unknown as Record<string, unknown>;
    }))

    .delete("/v1/namespaces/:ns/domains/:hostname", ({ params }) => handle(async () => {
      const ns = validateNamespace(params.ns);
      const hostname = normalizeHostnameOrThrow(params.hostname);
      await detachDomain(ns, hostname);
      return { deleted: true };
    }))

    // Builder completion webhook. Auth: per-build HMAC token over (buildId, ns, key).
    // Body is buildctl's metadata JSON on success, or an error text on failure.
    // `parse: "text"` so a malformed/empty JSON body still reaches the handler (Elysia's
    // default JSON parser would 400 before it, making the registry-HEAD digest fallback
    // unreachable) — the handler parses defensively.
    .post("/internal/builds/:buildId/complete", ({ params, query, body, request }) => handle(async () => {
      const ns = typeof query.ns === "string" ? query.ns : "";
      const key = typeof query.key === "string" ? query.key : "";
      const status = query.status === "succeeded" ? "succeeded" : query.status === "failed" ? "failed" : null;
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      if (ns === "" || key === "" || status === null) throw new MarshalError(400, "bad_request", "ns, key, and status query params are required");
      // Validate ns/key BEFORE trusting them: they flow into S3 keys inside completeBuild, and
      // possession of the webhook secret (which defaults to the API key) must not become an
      // arbitrary-key write primitive.
      validateNamespace(ns);
      validateServiceKey(key);
      if (!verifyWebhookToken(token, params.buildId, ns, key)) {
        return jsonResponse(401, { error: "unauthenticated", message: "invalid webhook token" });
      }
      if (!BUILD_ID_REGEX.test(params.buildId)) throw new MarshalError(400, "bad_request", "build id must be a ULID");
      const bodyText = typeof body === "string" ? body : body === null || body === undefined ? null : JSON.stringify(body);
      await completeBuild({
        ns,
        key,
        buildId: params.buildId,
        status,
        metadataJson: status === "succeeded" ? bodyText : null,
        errorText: status === "failed" ? bodyText : null,
      });
      return { ok: true };
    }), { parse: "text" });

  return { app, builder };
}
