#!/usr/bin/env node
/**
 * Single-port front door for running the Hexclave self-host image on Railway.
 *
 * Why this exists: the self-host image runs two servers — the Elysia backend on
 * BACKEND_PORT and the Next.js dashboard on DASHBOARD_PORT. Railway routes a
 * domain to exactly one target port, so exposing both previously required a
 * second Railway service running Caddy purely to path-route between them. This
 * process does that routing inside the container instead, so the whole product
 * is one Railway service behind one domain, with no cross-service network hop.
 *
 * It deliberately has zero npm dependencies: it is layered onto a prebuilt image
 * whose node_modules tree belongs to the application, and adding a dependency
 * here would mean re-resolving that tree on every overlay build.
 */

import http from "node:http";
import net from "node:net";

const UPSTREAM_HOST = "127.0.0.1";

/**
 * Railway injects PORT. Everything else keeps the image's own defaults so this
 * proxy stays usable outside Railway (docker run -p 8080:8080) without extra config.
 */
const PUBLIC_PORT = Number(process.env.PORT || 8080);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8102);
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || 8101);
const HEALTH_PATH = process.env.HEXCLAVE_RAILWAY_HEALTH_PATH || "/__railway/health";

/**
 * Fail loudly rather than binding a port that shadows one of the upstreams —
 * that failure mode is a confusing infinite proxy loop rather than a clean crash.
 */
for (const [name, value] of new Map([
  ["PORT", PUBLIC_PORT],
  ["BACKEND_PORT", BACKEND_PORT],
  ["DASHBOARD_PORT", DASHBOARD_PORT],
])) {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`railway/proxy: ${name} must be a valid TCP port, but resolved to "${value}"`);
  }
}
if (PUBLIC_PORT === BACKEND_PORT || PUBLIC_PORT === DASHBOARD_PORT) {
  throw new Error(
    `railway/proxy: PORT (${PUBLIC_PORT}) collides with BACKEND_PORT (${BACKEND_PORT}) or DASHBOARD_PORT (${DASHBOARD_PORT}). `
    + "The public port must be distinct from both upstream ports.",
  );
}

/**
 * Hop-by-hop headers are per-connection and must not be forwarded across a proxy
 * (RFC 9110 7.6.1). Node sets its own Connection/Transfer-Encoding per hop, and
 * forwarding the client's values corrupts keep-alive and chunked framing.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Paths answered with 204 instead of being forwarded. The dashboard bundle ships
 * Vercel Analytics and PostHog beacons that have no receiver in a self-hosted
 * deployment; without this they become a steady stream of 404s in the dashboard's
 * logs and browser console. Kept behaviourally identical to the Caddy config this
 * replaces so existing deployments see no change.
 */
const BLACKHOLED_PATH_PREFIXES = ["/_vercel/", "/consume/"];

const PROBE_TIMEOUT_MS = 5000;

function stripHopByHopHeaders(headers) {
  const forwarded = Object.create(null);
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      forwarded[name] = value;
    }
  }
  return forwarded;
}

/**
 * Railway's edge sets X-Forwarded-* before the request reaches this container, and
 * the backend reads them to decide the external scheme/host (it only trusts them
 * when HEXCLAVE_TRUSTED_PROXY is set). Preserve the edge's values and append this
 * hop to X-Forwarded-For rather than overwriting, or the backend would conclude
 * every request arrived over plain HTTP from localhost.
 */
function buildUpstreamHeaders(req) {
  const headers = stripHopByHopHeaders(req.headers);
  const remoteAddress = req.socket.remoteAddress;
  const existingForwardedFor = req.headers["x-forwarded-for"];
  headers["x-forwarded-for"] = existingForwardedFor == null
    ? remoteAddress
    : `${existingForwardedFor}, ${remoteAddress}`;
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] || "http";
  headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers.host;
  return headers;
}

function startupHtml() {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Starting up</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: Canvas; color: CanvasText; }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.125rem; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .75; }
</style>
<main>
  <h1>Hexclave is starting up</h1>
  <p>First boot runs database migrations and can take a few minutes. This page will work once startup finishes &mdash; refresh shortly.</p>
</main>`;
}

function respondStartupPending(res) {
  if (res.headersSent) return;
  res.writeHead(503, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": "15",
  });
  res.end(startupHtml());
}

function respondBadGateway(res, error) {
  if (res.headersSent) return;
  res.writeHead(502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(`Upstream request failed: ${error.code || error.message}\n`);
}

/**
 * Probe an upstream for the health endpoint. Resolves rather than rejects on
 * failure on purpose: for a health check an unreachable upstream is the answer,
 * not an exceptional condition.
 */
function probeUpstream(port, path) {
  return new Promise((resolve) => {
    const request = http.request(
      { host: UPSTREAM_HOST, port, path, method: "GET", timeout: PROBE_TIMEOUT_MS },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 400, status, error: null });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false, status: null, error: "timeout" });
    });
    request.on("error", (error) => {
      resolve({ ok: false, status: null, error: error.code || error.message });
    });
    request.end();
  });
}

/**
 * Reports healthy only when both upstreams are serving. The Caddy service this
 * replaces answered its health path with a static "ok", which meant Railway
 * reported the deployment healthy while the application behind it was still
 * migrating or had crashed. `?db=1` makes the backend verify database
 * connectivity rather than just that the process is listening.
 */
async function handleHealth(res) {
  const [backend, dashboard] = await Promise.all([
    probeUpstream(BACKEND_PORT, "/health?db=1"),
    probeUpstream(DASHBOARD_PORT, "/"),
  ]);
  const healthy = backend.ok && dashboard.ok;
  res.writeHead(healthy ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ status: healthy ? "healthy" : "starting", backend, dashboard }));
}

function proxyRequest(req, res, port) {
  const upstream = http.request({
    host: UPSTREAM_HOST,
    port,
    method: req.method,
    path: req.url,
    headers: buildUpstreamHeaders(req),
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, stripHopByHopHeaders(upstreamRes.headers));
    upstreamRes.pipe(res);
  });

  upstream.on("error", (error) => {
    // ECONNREFUSED means the upstream has not bound its port yet, which during a
    // cold start is expected for the several minutes migrations take. Anything
    // else is a genuine failure and should not be dressed up as "still starting".
    if (error.code === "ECONNREFUSED") {
      respondStartupPending(res);
    } else {
      console.error(`railway/proxy: upstream ${port} request failed: ${error.code || error.message}`);
      respondBadGateway(res, error);
    }
    req.destroy();
  });

  // Without this, a client that disconnects mid-upload leaves the upstream request
  // open until its own timeout, holding a backend connection per abandoned request.
  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy();
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];

  if (path === HEALTH_PATH) {
    handleHealth(res).catch((error) => {
      console.error(`railway/proxy: health check failed: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ status: "error", error: error.message }));
      }
    });
    return;
  }

  if (BLACKHOLED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    res.writeHead(204).end();
    return;
  }

  // The backend owns everything under /api; the dashboard owns the rest. This is
  // the same split the Caddy service used, which keeps existing deployments'
  // NEXT_PUBLIC_HEXCLAVE_API_URL (the bare origin) valid — every SDK route the
  // backend serves is namespaced under /api/.
  const isApi = path === "/api" || path.startsWith("/api/");
  proxyRequest(req, res, isApi ? BACKEND_PORT : DASHBOARD_PORT);
});

/**
 * Pass CONNECT/WebSocket upgrades through untouched. Nothing in the dashboard
 * relies on this today, but a proxy that silently drops upgrades produces a
 * failure that is very hard to trace back to here if that ever changes.
 */
server.on("upgrade", (req, clientSocket, head) => {
  const path = (req.url || "/").split("?")[0];
  const port = path === "/api" || path.startsWith("/api/") ? BACKEND_PORT : DASHBOARD_PORT;
  const upstreamSocket = net.connect(port, UPSTREAM_HOST, () => {
    const headerLines = Object.entries(req.headers).map(([name, value]) => `${name}: ${value}`);
    upstreamSocket.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`);
    if (head && head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstreamSocket.on("error", (error) => {
    console.error(`railway/proxy: upgrade to ${port} failed: ${error.code || error.message}`);
    clientSocket.destroy();
  });
  clientSocket.on("error", () => upstreamSocket.destroy());
});

server.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(
    `railway/proxy: listening on 0.0.0.0:${PUBLIC_PORT} `
    + `(/api -> ${BACKEND_PORT}, else -> ${DASHBOARD_PORT}, health ${HEALTH_PATH})`,
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
