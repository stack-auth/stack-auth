import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const PROXY_PATH = fileURLToPath(new URL("./proxy.mjs", import.meta.url));

/**
 * Asks the OS for a free port and immediately releases it. Racy in principle, but
 * the alternative — hardcoded ports — collides with whatever else the developer
 * has running, which fails far more often in practice.
 */
function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Polls until the predicate holds, so tests wait on readiness rather than a guessed sleep. */
async function waitFor(predicate, { timeoutMs = 10_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`);
}

describe("railway proxy", () => {
  let publicPort;
  let backendPort;
  let dashboardPort;
  let proxy;
  let backend;
  let dashboard;

  beforeAll(async () => {
    [publicPort, backendPort, dashboardPort] = await Promise.all([
      reservePort(), reservePort(), reservePort(),
    ]);

    // Started with both upstreams deliberately down, so the cold-start behaviour
    // (the path a real Railway deploy takes while migrations run) is exercised first.
    proxy = spawn(process.execPath, [PROXY_PATH], {
      env: {
        ...process.env,
        PORT: String(publicPort),
        BACKEND_PORT: String(backendPort),
        DASHBOARD_PORT: String(dashboardPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proxy.stdout.resume();
    proxy.stderr.resume();

    await waitFor(async () => (await request(publicPort, "/__railway/health")).status === 503);

    backend = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        upstream: "backend",
        url: req.url,
        forwardedProto: req.headers["x-forwarded-proto"],
        forwardedFor: req.headers["x-forwarded-for"],
        forwardedHost: req.headers["x-forwarded-host"],
      }));
    });
    dashboard = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`dashboard ${req.url}`);
    });
  });

  afterAll(async () => {
    proxy?.kill("SIGTERM");
    if (backend?.listening) await close(backend);
    if (dashboard?.listening) await close(dashboard);
  });

  test("serves a startup page instead of an error while the upstreams are still booting", async () => {
    // A cold Railway deploy spends minutes running migrations before either
    // upstream binds. A bare 502 there reads as a broken deployment.
    const response = await request(publicPort, "/projects");
    expect(response.status).toBe(503);
    expect(response.body).toContain("Hexclave is starting up");
    expect(response.headers["retry-after"]).toBe("15");
  });

  test("reports unhealthy, with per-upstream detail, until both upstreams answer", async () => {
    const response = await request(publicPort, "/__railway/health");
    expect(response.status).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("starting");
    expect(body.backend.ok).toBe(false);
    expect(body.dashboard.ok).toBe(false);
  });

  test("reports healthy once both upstreams answer", async () => {
    await listen(backend, backendPort);
    await listen(dashboard, dashboardPort);
    const response = await waitFor(async () => {
      const attempt = await request(publicPort, "/__railway/health");
      return attempt.status === 200 ? attempt : false;
    });
    expect(JSON.parse(response.body).status).toBe("healthy");
  });

  test("routes /api to the backend and everything else to the dashboard", async () => {
    const api = await request(publicPort, "/api/latest/users/me");
    expect(api.status).toBe(200);
    expect(JSON.parse(api.body).upstream).toBe("backend");
    expect(JSON.parse(api.body).url).toBe("/api/latest/users/me");

    const page = await request(publicPort, "/projects/abc");
    expect(page.status).toBe(200);
    expect(page.body).toBe("dashboard /projects/abc");
  });

  test("answers analytics beacons with 204 rather than forwarding them", async () => {
    // These have no receiver in a self-hosted deployment; forwarding them just
    // fills the dashboard's logs with 404s.
    expect((await request(publicPort, "/_vercel/insights/view")).status).toBe(204);
    expect((await request(publicPort, "/consume/anything")).status).toBe(204);
  });

  test("preserves the edge's forwarded headers and appends its own hop", async () => {
    // The backend derives the external scheme and host from these. Overwriting
    // rather than appending would make every request look like plain HTTP from
    // localhost, which breaks secure-cookie and redirect handling.
    const response = await request(publicPort, "/api/probe", {
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.9",
      "x-forwarded-host": "auth.example.com",
    });
    const body = JSON.parse(response.body);
    expect(body.forwardedProto).toBe("https");
    expect(body.forwardedHost).toBe("auth.example.com");
    expect(body.forwardedFor).toBe("203.0.113.9, 127.0.0.1");
  });
});

test("refuses to start when the public port collides with an upstream port", async () => {
  // Binding the same port the backend wants produces an infinite proxy loop rather
  // than a clean failure, so this has to be rejected up front.
  const port = await reservePort();
  const child = spawn(process.execPath, [PROXY_PATH], {
    env: { ...process.env, PORT: String(port), BACKEND_PORT: String(port), DASHBOARD_PORT: "8101" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));
  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("collides with");
});
