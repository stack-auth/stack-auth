import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { NodeRuntime } from "secure-exec";

const PORT = Number(process.env.PORT || 8080);
const DEFAULT_TIMEOUT_MS = 30_000;
const OUTER_TIMEOUT_GRACE_MS = 1_000;
const MAX_IN_FLIGHT = 8;
const MAX_JOBS_PER_RUNTIME = 50;
const MAX_NON_DEFAULT_RUNTIMES = 3;
const NPM_INSTALL_TIMEOUT_MS = 60_000;
const MODULE_CACHE_DIR = process.env.MODULE_CACHE_DIR || "/app/module-cache";
const DEFAULT_NODE_MODULES_DIR = "/app/node_modules";
const USER_MODULE_DIR = "/tmp";
const BRIDGED_HOSTS = [
  ...new Set(
    (process.env.BRIDGED_HOSTS || process.env.HOST_ON_HOST || "host.docker.internal")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ),
];

const defaultNodeModules = new Map([
  ["@react-email/components", "1.0.6"],
  ["arktype", "2.1.20"],
  ["react", "19.1.1"],
  ["react-dom", "19.1.1"],
]);

function normalizeNodeModules(nodeModules) {
  return Object.fromEntries(
    Object.entries(nodeModules || {})
      .map(([name, version]) => [name, String(version)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function hashNodeModules(nodeModules) {
  return createHash("sha256")
    .update(JSON.stringify(nodeModules))
    .digest("hex");
}

function isSatisfiedByDefault(nodeModules) {
  return Object.entries(nodeModules).every(
    ([name, version]) => defaultNodeModules.get(name) === version,
  );
}

function formatError(error) {
  return error?.message || String(error);
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

function runNpmInstall(workDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: workDir,
      stdio: "ignore",
    });
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, new Error(`npm install timed out after ${NPM_INSTALL_TIMEOUT_MS}ms`));
    }, NPM_INSTALL_TIMEOUT_MS);

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    }

    child.once("error", (error) => {
      settle(reject, new Error(`Failed to spawn npm install: ${formatError(error)}`));
    });
    child.once("close", (code) => {
      if (code === 0) settle(resolve);
      else settle(reject, new Error(`npm install failed with code ${code}`));
    });
  });
}

class DependencyCache {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.installPromises = new Map();
  }

  async get(nodeModules) {
    const normalized = normalizeNodeModules(nodeModules);
    if (isSatisfiedByDefault(normalized)) {
      return { hash: "default", nodeModulesPath: DEFAULT_NODE_MODULES_DIR, isDefault: true };
    }

    const hash = hashNodeModules(normalized);
    const nodeModulesPath = join(this.rootDir, hash, "node_modules");
    const installPromise = this.installPromises.get(hash);
    if (installPromise) {
      await installPromise;
      return { hash, nodeModulesPath, isDefault: false };
    }

    const promise = this.ensureInstalled(join(this.rootDir, hash), normalized);
    this.installPromises.set(hash, promise);
    try {
      await promise;
    } finally {
      this.installPromises.delete(hash);
    }
    return { hash, nodeModulesPath, isDefault: false };
  }

  async ensureInstalled(cachePath, nodeModules) {
    const completeMarker = join(cachePath, ".complete");
    try {
      await readFile(completeMarker);
      return;
    } catch {
      // An absent marker means the directory is either new or from an
      // interrupted install. Rebuild it atomically below.
    }

    const tempPath = `${cachePath}.tmp-${randomUUID()}`;
    await rm(tempPath, { recursive: true, force: true });
    await mkdir(tempPath, { recursive: true });
    try {
      await writeFile(
        join(tempPath, "package.json"),
        JSON.stringify({ private: true, type: "module", dependencies: nodeModules }),
      );
      await runNpmInstall(tempPath);
      await writeFile(join(tempPath, ".complete"), "ok\n");
      await rm(cachePath, { recursive: true, force: true });
      await rename(tempPath, cachePath);
    } catch (error) {
      await rm(tempPath, { recursive: true, force: true });
      throw error;
    }
  }
}

class RuntimeCache {
  constructor() {
    this.entries = new Map();
  }

  async acquire(dependency) {
    for (;;) {
      let entry = this.entries.get(dependency.hash);
      if (entry && !entry.retiring) {
        entry.activeJobs++;
        entry.lastUsed = performance.now();
        return entry;
      }

      if (!entry) {
        const evicted = await this.evictInactiveRuntime();
        if (!dependency.isDefault && !evicted && this.nonDefaultCount() >= MAX_NON_DEFAULT_RUNTIMES) {
          await this.waitForRuntime();
          continue;
        }
        entry = await this.createEntry(dependency);
        this.entries.set(dependency.hash, entry);
      } else {
        await this.recycleEntry(entry, dependency);
        entry = this.entries.get(dependency.hash);
      }

      entry.activeJobs++;
      entry.lastUsed = performance.now();
      return entry;
    }
  }

  async createEntry(dependency) {
    const runtime = await NodeRuntime.create({
      nodeModules: dependency.nodeModulesPath,
      // The host callback below is deliberately limited to the configured
      // development backend origin. Secure Exec unconditionally blocks the
      // RFC1918 address behind host.docker.internal, so this is an explicit
      // dev/CI-only hole rather than a general private-network escape.
      permissions: {
        network: "allow",
        // This runtime registers exactly one binding, so allowing the binding
        // scope cannot expose any unrelated host capability.
        binding: "allow",
      },
      bindings: {
        "freestyle-host-fetch": {
          description: "Fetch an HTTP resource on the configured development host",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              method: { type: "string" },
              headers: { type: "object" },
              bodyBase64: { type: ["string", "null"] },
            },
            required: ["url", "method", "headers"],
            additionalProperties: false,
          },
          timeoutMs: DEFAULT_TIMEOUT_MS,
          handler: hostFetch,
        },
      },
    });
    return {
      hash: dependency.hash,
      isDefault: dependency.isDefault,
      nodeModulesPath: dependency.nodeModulesPath,
      runtime,
      activeJobs: 0,
      jobsHandled: 0,
      lastUsed: performance.now(),
      retiring: false,
      recycling: null,
    };
  }

  async evictInactiveRuntime() {
    const candidates = [...this.entries.values()]
      .filter((entry) => !entry.isDefault && entry.activeJobs === 0 && !entry.retiring)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const candidate = candidates[0];
    if (!candidate) return false;
    this.entries.delete(candidate.hash);
    await candidate.runtime.dispose();
    return true;
  }

  async recycleEntry(entry, dependency) {
    if (entry.recycling) {
      await entry.recycling;
      return;
    }
    entry.recycling = (async () => {
      while (entry.activeJobs > 0) await new Promise((resolve) => setTimeout(resolve, 10));
      await entry.runtime.dispose();
      const replacement = await this.createEntry(dependency);
      this.entries.set(dependency.hash, replacement);
    })();
    try {
      await entry.recycling;
    } finally {
      entry.recycling = null;
    }
  }

  release(entry) {
    entry.activeJobs--;
    entry.jobsHandled++;
    entry.lastUsed = performance.now();
    if (entry.jobsHandled >= MAX_JOBS_PER_RUNTIME) {
      entry.retiring = true;
      if (entry.activeJobs === 0 && !entry.recycling) {
        this.recycleEntry(entry, {
          hash: entry.hash,
          isDefault: entry.isDefault,
          nodeModulesPath: entry.nodeModulesPath,
        }).catch((error) => console.error("Failed to recycle secure-exec runtime:", error));
      }
    }
  }

  nonDefaultCount() {
    return [...this.entries.values()].filter((entry) => !entry.isDefault).length;
  }

  async waitForRuntime() {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

class JobQueue {
  constructor(runtimeCache, dependencyCache) {
    this.runtimeCache = runtimeCache;
    this.dependencyCache = dependencyCache;
    this.queue = [];
    this.activeJobs = 0;
  }

  submit(script, config, timeoutMs) {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const job = {
        script,
        config,
        timeoutMs,
        controller,
        started: false,
        settled: false,
        resolve,
      };
      job.timer = setTimeout(() => {
        job.controller.abort(new Error(`Freestyle mock job timed out after ${timeoutMs}ms`));
        this.settle(job, {
          statusCode: 500,
          payload: { error: `Freestyle mock job timed out after ${timeoutMs}ms`, logs: [] },
        });
      }, timeoutMs + OUTER_TIMEOUT_GRACE_MS);
      this.queue.push(job);
      this.dispatch();
    });
  }

  settle(job, result) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    job.resolve(result);
  }

  dispatch() {
    while (this.activeJobs < MAX_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift();
      if (job.settled) continue;
      this.activeJobs++;
      job.started = true;
      this.execute(job)
        .then((result) => this.settle(job, result))
        .catch((error) => this.settle(job, {
          statusCode: 500,
          payload: { error: formatError(error), logs: [] },
        }))
        .finally(() => {
          this.activeJobs--;
          this.dispatch();
        });
    }
  }

  async execute(job) {
    let entry;
    try {
      const dependency = await this.dependencyCache.get(job.config.nodeModules);
      entry = await this.runtimeCache.acquire(dependency);
      return await executeScript(entry.runtime, job.script, job.config, job.controller.signal);
    } finally {
      if (entry) this.runtimeCache.release(entry);
    }
  }
}

function makeWrapper(userModulePath) {
  return `
const logs = [];
for (const type of ["log", "info", "warn", "error", "debug"]) {
  const original = console[type];
  console[type] = (...args) => {
    logs.push({ message: args.map(String).join(" "), type });
    original(...args);
  };
}
const bridgedHosts = ${JSON.stringify(BRIDGED_HOSTS)};
const originalFetch = globalThis.fetch;
const encodeBase64 = (bytes) => {
  let output = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    output += btoa(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  return output;
};
const decodeBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
// Deliberate dev/CI-only boundary hole: Secure Exec rejects RFC1918
// destinations, while Hexclave's local backend is only reachable through
// host.docker.internal. Only the configured development-host hostnames use
// this host callback; all other URLs retain Secure Exec's network policy.
const bridgedFetch = async (input, init) => {
  const request = new Request(input, init);
  const target = new URL(request.url);
  if (!bridgedHosts.includes(target.hostname)) {
    return originalFetch(input, init);
  }
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD"
    ? null
    : encodeBase64(new Uint8Array(await request.arrayBuffer()));
  const bridged = await globalThis.callBinding("freestyle-host-fetch", {
    url: request.url,
    method,
    headers: Object.fromEntries(request.headers),
    bodyBase64: body,
  });
  return new Response(decodeBase64(bridged.bodyBase64), {
    status: bridged.status,
    statusText: bridged.statusText,
    headers: bridged.headers,
  });
};
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: bridgedFetch,
});
try {
  const userModule = await import(${JSON.stringify(userModulePath)});
  const exported = userModule.default ?? userModule;
  const result = await (typeof exported === "function" ? exported() : exported);
  globalThis.__return({ status: "ok", result, logs });
} catch (error) {
  globalThis.__return({
    status: "error",
    error: error?.message || String(error),
    logs,
  });
}
`;
}

async function hostFetch(input) {
  const url = new URL(input.url);
  // Defense in depth: the guest shim checks this too, but the host callback
  // must never become a general-purpose private-network request primitive.
  if (!BRIDGED_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error(`Host callback only permits configured development hosts: ${url.hostname}`);
  }
  const requestInit = {
    method: input.method,
    headers: input.headers,
  };
  if (input.bodyBase64 != null) {
    requestInit.body = Buffer.from(input.bodyBase64, "base64");
  }
  const response = await fetch(url, requestInit);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers),
    bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
  };
}

async function executeScript(runtime, script, config, signal) {
  const userModulePath = `${USER_MODULE_DIR}/user-${randomUUID()}.mjs`;
  await runtime.writeFile(userModulePath, script);
  const timeoutMs = Number.isFinite(config.timeout) && config.timeout > 0
    ? config.timeout
    : DEFAULT_TIMEOUT_MS;
  const result = await runtime.run(makeWrapper(userModulePath), {
    env: config.envVars || {},
    timeout: timeoutMs,
    signal,
  });

  if (result.exitCode !== 0 || result.value === undefined) {
    const stderr = result.stderr.trim();
    const detail = stderr ? `: ${stderr}` : ` (exit code ${result.exitCode})`;
    return {
      statusCode: 500,
      payload: { error: `Secure Exec execution failed${detail}`, logs: [] },
    };
  }
  if (result.value.status === "error") {
    return { statusCode: 500, payload: { error: result.value.error, logs: result.value.logs } };
  }
  return { statusCode: 200, payload: { result: result.value.result, logs: result.value.logs } };
}

const dependencyCache = new DependencyCache(MODULE_CACHE_DIR);
const runtimeCache = new RuntimeCache();
const jobQueue = new JobQueue(runtimeCache, dependencyCache);

await mkdir(MODULE_CACHE_DIR, { recursive: true });
await runtimeCache.acquire({
  hash: "default",
  isDefault: true,
  nodeModulesPath: DEFAULT_NODE_MODULES_DIR,
});
const defaultEntry = runtimeCache.entries.get("default");
runtimeCache.release(defaultEntry);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const isExecutePath =
      request.method === "POST" &&
      /^\/execute\/v[123]\/script$/.test(url.pathname);
    if (!isExecutePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const body = await readRequestBody(request);
    if (typeof body.script !== "string") {
      throw new Error("Request body must contain a string script");
    }
    const config = body.config && typeof body.config === "object" ? body.config : {};
    const timeoutMs = Number.isFinite(config.timeout) && config.timeout > 0
      ? config.timeout
      : DEFAULT_TIMEOUT_MS;
    const result = await jobQueue.submit(body.script, config, timeoutMs);
    sendJson(response, result.statusCode, result.payload);
  } catch (error) {
    sendJson(response, 500, { error: formatError(error), logs: [] });
  }
});

server.listen(PORT, () => {
  console.log(`freestyle-mock listening on :${PORT}`);
});
