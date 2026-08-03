FROM node:22-slim

# A minimal in-memory mock of the subset of the Fly.io APIs used by Marshal
# (apps/marshal/src/fly/client.ts): the Machines REST API, the certs/IP GraphQL
# API, and the HTTP logs API. Used by e2e tests and local development so CI
# never talks to real Fly.
#
# Deterministic behaviors tests rely on:
# - Machines are "started" immediately on create/update/start; /wait returns
#   instantly. Every machine lifecycle event appends a line to the app's logs.
# - Hostnames ending in ".verified.test" get clientStatus "Ready" immediately;
#   all others stay "Awaiting configuration" with DNS-validation records.
# - Adding a hostname that already exists on the SAME app errors with
#   "Hostname already exists on app" — but duplicates ACROSS apps are allowed,
#   matching real Fly (the smoke test proved Fly does not enforce cross-app
#   uniqueness; Marshal's own domain registry is what yields the 409).
# - The logs API mimics Fly's auth quirk: it REJECTS "Bearer <token>" and only
#   accepts the raw token as the authorization header (Marshal's client depends
#   on this difference staying visible in dev).
# - GET /__mock/apps and /__mock/apps/:name expose full app state (machines
#   with env/metadata, certs, IPs) for test assertions.

WORKDIR /app

RUN cat <<'EOF' > server.mjs
import http from "node:http";

const EXPECTED_TOKEN = "mock_hexclave_fly_key";

let machineCounter = 0;
let ipCounter = 0;
let certCounter = 0;
let logNanos = 1_000_000_000_000n * 1_000_000n;
const appsByName = new Map();

function sendJson(res, status, body) {
  // Connection: close on every response: Marshal's HTTP client otherwise
  // races this server's keep-alive idle close through the docker port proxy,
  // which surfaces as multi-second request stalls in tests. The mock has no
  // performance requirements, so per-request connections are the simple fix.
  res.writeHead(status, { "content-type": "application/json", "connection": "close" });
  res.end(JSON.stringify(body));
}

function makeApp(name, orgSlug, network) {
  return {
    name,
    orgSlug,
    network: network ?? "default",
    status: "deployed",
    machinesById: new Map(),
    certsByHostname: new Map(),
    sharedIpv4: null,
    dedicatedIps: [],
    logs: [],
  };
}

function appendLog(app, message, { instance = null, provider = "runner", level = "info" } = {}) {
  logNanos += 1_000_000n; // 1ms apart, strictly monotonic
  app.logs.push({
    id: `mocklog-${logNanos}`,
    nanos: logNanos,
    attributes: {
      timestamp: new Date(Number(logNanos / 1_000_000n)).toISOString(),
      message,
      level,
      instance,
      region: "mock",
      meta: { event: provider === null ? null : { provider } },
    },
  });
}

function machineJson(machine) {
  return {
    id: machine.id,
    name: machine.name,
    state: machine.state,
    region: machine.region,
    instance_id: machine.instanceId,
    config: machine.config,
  };
}

function certJson(cert) {
  const verified = cert.hostname.endsWith(".verified.test");
  const labels = cert.hostname.split(".");
  return {
    id: cert.id,
    hostname: cert.hostname,
    configured: verified,
    acmeDnsConfigured: verified,
    clientStatus: verified ? "Ready" : "Awaiting configuration",
    dnsValidationHostname: `_acme-challenge.${cert.hostname}`,
    dnsValidationTarget: `${cert.hostname}.mock00.flydns.net.`,
    isApex: labels.length <= 2,
    issued: { nodes: verified ? [{ type: "rsa", expiresAt: "2100-01-01T00:00:00Z" }] : [] },
  };
}

function graphqlError(res, message, code) {
  sendJson(res, 200, { data: null, errors: [{ message, extensions: { code } }] });
}

function handleGraphql(res, body) {
  const query = body.query ?? "";
  const vars = body.variables ?? {};
  if (query.includes("allocateIpAddress")) {
    const { appId, type } = vars.input ?? {};
    const app = appsByName.get(appId);
    if (!app) return graphqlError(res, `Could not find App "${appId}"`, "NOT_FOUND");
    if (type === "shared_v4") {
      app.sharedIpv4 = app.sharedIpv4 ?? "66.51.0.1";
      return sendJson(res, 200, { data: { allocateIpAddress: { ipAddress: null, app: { name: app.name, sharedIpAddress: app.sharedIpv4 } } } });
    }
    const ip = {
      id: `ip_mock${++ipCounter}`,
      address: type === "private_v6" ? `fdaa:0:mock::${ipCounter}` : `2a09:8280:mock::${ipCounter}`,
      type,
    };
    app.dedicatedIps.push(ip);
    return sendJson(res, 200, { data: { allocateIpAddress: { ipAddress: ip, app: { name: app.name } } } });
  }
  if (query.includes("releaseIpAddress")) {
    const { appId, ipAddressId, ip } = vars.input ?? {};
    const app = appsByName.get(appId);
    if (!app) return graphqlError(res, `Could not find App "${appId}"`, "NOT_FOUND");
    if (ip !== undefined && app.sharedIpv4 === ip) app.sharedIpv4 = null;
    if (ipAddressId !== undefined) app.dedicatedIps = app.dedicatedIps.filter((entry) => entry.id !== ipAddressId);
    return sendJson(res, 200, { data: { releaseIpAddress: { app: { name: app.name, sharedIpAddress: app.sharedIpv4 } } } });
  }
  if (query.includes("addCertificate")) {
    const { appId, hostname } = vars;
    const app = appsByName.get(appId);
    if (!app) return graphqlError(res, `Could not find App "${appId}"`, "NOT_FOUND");
    if (app.certsByHostname.has(hostname)) {
      return graphqlError(res, "Hostname already exists on app", "UNPROCESSABLE");
    }
    const cert = { id: `cert_mock${++certCounter}`, hostname };
    app.certsByHostname.set(hostname, cert);
    return sendJson(res, 200, { data: { addCertificate: { certificate: certJson(cert) } } });
  }
  if (query.includes("deleteCertificate")) {
    const { appId, hostname } = vars;
    const app = appsByName.get(appId);
    if (!app) return graphqlError(res, `Could not find App "${appId}"`, "NOT_FOUND");
    const cert = app.certsByHostname.get(hostname);
    if (!cert) return graphqlError(res, `Could not find Certificate for "${hostname}"`, "NOT_FOUND");
    app.certsByHostname.delete(hostname);
    return sendJson(res, 200, { data: { deleteCertificate: { certificate: { id: cert.id, hostname } } } });
  }
  // Everything else is the app read query (ips, certificate, certificates).
  const app = appsByName.get(vars.app);
  if (!app) return sendJson(res, 200, { data: { app: null } });
  const certificate = vars.hostname !== undefined && app.certsByHostname.has(vars.hostname)
    ? certJson(app.certsByHostname.get(vars.hostname))
    : null;
  return sendJson(res, 200, {
    data: {
      app: {
        name: app.name,
        sharedIpAddress: app.sharedIpv4,
        ipAddresses: { nodes: app.dedicatedIps },
        certificate,
        certificates: { nodes: [...app.certsByHostname.values()].map(certJson) },
      },
    },
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const auth = req.headers.authorization ?? "";

  // Test-only introspection (no auth, like the vercel-mock's /__mock namespace).
  // The listing includes machine metadata/env so e2e tests can find the app
  // belonging to a (namespace, service key) pair without knowing Marshal's
  // naming scheme (machines carry hexclave_ns/hexclave_key metadata).
  if (path === "/__mock/apps") {
    return sendJson(res, 200, {
      apps: [...appsByName.values()].map((app) => ({
        name: app.name,
        machines: [...app.machinesById.values()].map((machine) => ({
          id: machine.id,
          image: machine.config.image,
          metadata: machine.config.metadata ?? {},
          env: machine.config.env ?? {},
        })),
        certificates: [...app.certsByHostname.values()].map(certJson),
      })),
    });
  }
  const mockAppMatch = /^\/__mock\/apps\/([^/]+)$/.exec(path);
  if (mockAppMatch) {
    const app = appsByName.get(mockAppMatch[1]);
    if (!app) return sendJson(res, 404, { error: "not found" });
    return sendJson(res, 200, {
      name: app.name,
      network: app.network,
      sharedIpv4: app.sharedIpv4,
      dedicatedIps: app.dedicatedIps,
      machines: [...app.machinesById.values()].map(machineJson),
      certificates: [...app.certsByHostname.values()].map(certJson),
    });
  }

  // Logs API: mimics Fly's auth quirk — raw token only, "Bearer <token>" is a 401.
  const logsMatch = /^\/api\/v1\/apps\/([^/]+)\/logs$/.exec(path);
  if (logsMatch) {
    if (auth !== EXPECTED_TOKEN) {
      res.writeHead(401, { "connection": "close" });
      return res.end();
    }
    const app = appsByName.get(logsMatch[1]);
    if (!app) {
      res.writeHead(401, { "connection": "close" }); // real Fly can't distinguish missing apps here either
      return res.end();
    }
    const nextToken = url.searchParams.get("next_token");
    const instance = url.searchParams.get("instance");
    const after = nextToken === null ? -1n : BigInt(nextToken);
    const entries = app.logs
      .filter((entry) => entry.nanos > after)
      .filter((entry) => instance === null || entry.attributes.instance === instance)
      .slice(0, 100);
    const lastNanos = entries.length > 0 ? entries[entries.length - 1].nanos : null;
    return sendJson(res, 200, {
      data: entries.map((entry) => ({ id: entry.id, type: "logs", attributes: entry.attributes })),
      meta: { next_token: lastNanos === null ? "" : String(lastNanos) },
    });
  }

  if (auth !== `Bearer ${EXPECTED_TOKEN}`) {
    return sendJson(res, 401, { error: "Invalid token in mock (expected the mock_hexclave_fly_key token)" });
  }

  if (path === "/graphql" && req.method === "POST") {
    return handleGraphql(res, JSON.parse(rawBody));
  }

  if (path === "/v1/apps" && req.method === "POST") {
    const body = JSON.parse(rawBody);
    if (appsByName.has(body.app_name)) {
      return sendJson(res, 422, { error: "Name has already been taken" });
    }
    appsByName.set(body.app_name, makeApp(body.app_name, body.org_slug, body.network));
    return sendJson(res, 201, { id: body.app_name, created_at: Date.now() });
  }

  const appMatch = /^\/v1\/apps\/([^/]+)(\/.*)?$/.exec(path);
  if (!appMatch) {
    return sendJson(res, 404, { error: `mock: unhandled path ${req.method} ${path}` });
  }
  const appName = appMatch[1];
  const subPath = appMatch[2] ?? "";
  const app = appsByName.get(appName);

  if (subPath === "" && req.method === "GET") {
    if (!app) return sendJson(res, 404, { error: "App not found" });
    return sendJson(res, 200, { name: app.name, status: app.status, organization: { slug: app.orgSlug } });
  }
  if (subPath === "" && req.method === "DELETE") {
    appsByName.delete(appName);
    return sendJson(res, 202, {});
  }
  if (!app) {
    return sendJson(res, 404, { error: "App not found" });
  }

  if (subPath === "/machines" && req.method === "GET") {
    return sendJson(res, 200, [...app.machinesById.values()].map(machineJson));
  }
  if (subPath === "/machines" && req.method === "POST") {
    const body = JSON.parse(rawBody);
    const machine = {
      id: `mock${String(++machineCounter).padStart(10, "0")}`,
      name: body.name ?? `machine-${machineCounter}`,
      state: "started",
      region: body.region ?? "mock",
      instanceId: `inst-${machineCounter}-1`,
      config: body.config ?? {},
      updates: 1,
    };
    app.machinesById.set(machine.id, machine);
    appendLog(app, `Machine created with image ${machine.config.image ?? "unknown"}`, { instance: machine.id });
    appendLog(app, `Machine started`, { instance: machine.id });
    appendLog(app, `mock app listening`, { instance: machine.id, provider: "app" });
    return sendJson(res, 200, machineJson(machine));
  }

  const machineMatch = /^\/machines\/([^/]+)(\/.*)?$/.exec(subPath);
  if (machineMatch) {
    const machine = app.machinesById.get(machineMatch[1]);
    const machineSub = machineMatch[2] ?? "";
    if (!machine) return sendJson(res, 404, { error: "Machine not found" });
    if (machineSub === "" && req.method === "GET") {
      return sendJson(res, 200, machineJson(machine));
    }
    if (machineSub === "" && req.method === "POST") {
      const body = JSON.parse(rawBody);
      machine.config = body.config ?? machine.config;
      machine.state = "started";
      machine.instanceId = `inst-${machine.id}-${++machine.updates}`;
      appendLog(app, `Machine updated to image ${machine.config.image ?? "unknown"}`, { instance: machine.id });
      return sendJson(res, 200, machineJson(machine));
    }
    if (machineSub === "" && req.method === "DELETE") {
      app.machinesById.delete(machine.id);
      appendLog(app, `Machine destroyed`, { instance: machine.id });
      return sendJson(res, 200, {});
    }
    if (machineSub === "/start" && req.method === "POST") {
      machine.state = "started";
      appendLog(app, `Machine started`, { instance: machine.id });
      return sendJson(res, 200, {});
    }
    if (machineSub === "/stop" && req.method === "POST") {
      machine.state = "stopped";
      appendLog(app, `Machine stopped`, { instance: machine.id });
      return sendJson(res, 200, {});
    }
    if (machineSub.startsWith("/wait") && req.method === "GET") {
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: `mock: unhandled path ${req.method} ${path}` });
});

server.listen(8080, () => console.log("fly-mock listening on 8080"));
EOF

EXPOSE 8080

CMD ["node", "server.mjs"]
