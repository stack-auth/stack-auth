import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { NodeRuntime } from "secure-exec";

const PORT = Number(process.env.PORT || 8080);
const DEFAULT_TIMEOUT_MS = 30_000;
// Keep this above the workflow step backstop of 630 seconds (600s + 30s).
const MAX_TIMEOUT_MS = 15 * 60_000;
const OUTER_TIMEOUT_GRACE_MS = 1_000;
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_QUEUE_DEPTH = 100;
const DEFAULT_MAX_IN_FLIGHT = 4;
const configuredMaxInFlight = process.env.HEXCLAVE_FREESTYLE_MOCK_MAX_IN_FLIGHT;
const MAX_IN_FLIGHT =
  configuredMaxInFlight == null
    ? DEFAULT_MAX_IN_FLIGHT
    : Number(configuredMaxInFlight);
if (
  !Number.isInteger(MAX_IN_FLIGHT) ||
  MAX_IN_FLIGHT < 1 ||
  MAX_IN_FLIGHT > 32
) {
  throw new Error("HEXCLAVE_FREESTYLE_MOCK_MAX_IN_FLIGHT must be an integer from 1 to 32");
}
const MAX_JOBS_PER_RUNTIME = 50;
const DEFAULT_MAX_NON_DEFAULT_RUNTIMES = 3;
const configuredMaxNonDefaultRuntimes =
  process.env.HEXCLAVE_FREESTYLE_MOCK_MAX_NON_DEFAULT_RUNTIMES;
const MAX_NON_DEFAULT_RUNTIMES =
  configuredMaxNonDefaultRuntimes == null
    ? DEFAULT_MAX_NON_DEFAULT_RUNTIMES
    : Number(configuredMaxNonDefaultRuntimes);
if (
  !Number.isInteger(MAX_NON_DEFAULT_RUNTIMES) ||
  MAX_NON_DEFAULT_RUNTIMES < 1 ||
  MAX_NON_DEFAULT_RUNTIMES > 32
) {
  throw new Error(
    "HEXCLAVE_FREESTYLE_MOCK_MAX_NON_DEFAULT_RUNTIMES must be an integer from 1 to 32",
  );
}
const NPM_INSTALL_TIMEOUT_MS = 60_000;
const PREPARATION_TIMEOUT_MS = NPM_INSTALL_TIMEOUT_MS + 60_000;
const MAX_NODE_MODULES = 20;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_NPM_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BRIDGE_BODY_BYTES = 4 * 1024 * 1024;
const MAX_BRIDGE_RESPONSE_BYTES = 8 * 1024 * 1024;
// secure-exec caps a registered host callback at five minutes. This is above
// every normal workflow callback budget; the job watchdog remains authoritative
// below it, while runtime retirement bounds callbacks that outlive their job.
const HOST_FETCH_TIMEOUT_MS = 5 * 60_000;
const MAX_BRIDGE_REDIRECTS = 5;
const requestMetrics = {
  requests: 0,
  completed: 0,
  active: 0,
  maxQueueDepth: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  durationBuckets: [0, 0, 0, 0, 0, 0],
};
const MODULE_CACHE_DIR =
  process.env.HEXCLAVE_FREESTYLE_MOCK_MODULE_CACHE_DIR || "/app/module-cache";
const DEFAULT_NODE_MODULES_DIR = "/app/guest-node-modules/node_modules";
const USER_MODULE_DIR = "/tmp/freestyle-jobs";
const BRIDGE_ENABLED =
  process.env.HEXCLAVE_FREESTYLE_MOCK_BRIDGE_ENABLED === "true";
const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX || "81";
const defaultBridgeOrigin = `http://${
  process.env.HOST_ON_HOST || "host.docker.internal"
}:${portPrefix}02`;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
]);
const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/;
const PACKAGE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function canonicalOrigin(url) {
  if (url.username || url.password || !url.port) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return `${url.protocol}//${normalizeHostname(url.hostname)}:${url.port}`;
}

function parseBridgeOrigins(value) {
  const origins = new Set();
  for (const rawOrigin of value.split(",")) {
    let origin = null;
    try {
      const url = new URL(rawOrigin.trim());
      if (url.pathname !== "/" || url.search || url.hash) throw new Error();
      origin = canonicalOrigin(url);
    } catch {
      // Invalid configuration is rejected below.
    }
    if (!origin) throw new Error(`Invalid bridge origin configuration: ${rawOrigin}`);
    origins.add(origin);
  }
  if (origins.size === 0) throw new Error("Bridge origin list is empty");
  return [...origins];
}

const BRIDGED_ORIGINS = BRIDGE_ENABLED
  ? parseBridgeOrigins(
      process.env.HEXCLAVE_FREESTYLE_MOCK_BRIDGE_ORIGINS ||
        defaultBridgeOrigin,
    )
  : [];

const defaultNodeModules = new Map(
  Object.entries(
    JSON.parse(
      await readFile("/app/guest-node-modules/package.json", "utf8"),
    ).dependencies || {},
  ),
);

class ClientError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

class QueueFullError extends ClientError {
  constructor() {
    super(429, "Execution queue is full");
  }
}

function recordRequestDuration(durationMs) {
  requestMetrics.completed++;
  requestMetrics.active--;
  requestMetrics.totalDurationMs += durationMs;
  requestMetrics.maxDurationMs = Math.max(requestMetrics.maxDurationMs, durationMs);
  const bucket = durationMs < 100
    ? 0
    : durationMs < 500
      ? 1
      : durationMs < 1_000
        ? 2
        : durationMs < 5_000
          ? 3
          : durationMs < 30_000
            ? 4
            : 5;
  requestMetrics.durationBuckets[bucket]++;
}

function readRequestMetrics() {
  return {
    ...requestMetrics,
    durationBuckets: [...requestMetrics.durationBuckets],
    queueDepth: jobQueue.queue.length,
  };
}

function resetRequestMetrics() {
  requestMetrics.requests = 0;
  requestMetrics.completed = 0;
  requestMetrics.maxQueueDepth = 0;
  requestMetrics.totalDurationMs = 0;
  requestMetrics.maxDurationMs = 0;
  requestMetrics.durationBuckets.fill(0);
}

function formatError(error) {
  return error?.message || String(error);
}

function logInternalError(context, error) {
  console.error(`[${context}]`, error);
}

function isSidecarFrameTimeout(error) {
  return formatError(error).includes("timed out waiting for sidecar protocol frame");
}

const DEAD_RUNTIME_ERROR_NAMES = new Set([
  "SidecarEventBufferOverflow",
  "SidecarProcessError",
  "SidecarProcessExited",
]);

function isDeadRuntimeError(error) {
  // The secure-exec facade does not re-export these core error classes, but
  // their names are stable and distinguish dead runtimes from script failures.
  if (error?.name && DEAD_RUNTIME_ERROR_NAMES.has(error.name)) {
    return true;
  }
  const message = formatError(error).toLowerCase();
  return (
    message.includes("resident runner exited before completing request") ||
    message.includes("resident runner is not running") ||
    message.includes("sidecar protocol stream ended") ||
    message.includes("sidecar exited with code") ||
    message.includes("unknown sidecar vm") ||
    message.includes("no such process")
  );
}

// @secure-exec/core has a fire-and-forget proc.kill() path without a catch for
// this sidecar timeout; letting it terminate the mock takes down every later
// E2E test that depends on the rendering service.
process.on("unhandledRejection", (reason) => {
  if (isSidecarFrameTimeout(reason)) {
    logInternalError("secure-exec sidecar kill", reason);
    return;
  }
  throw reason;
});

function isAllowedBridgeUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const origin = canonicalOrigin(url);
  return origin && BRIDGED_ORIGINS.includes(origin) ? url : null;
}

function normalizeNodeModules(nodeModules) {
  if (nodeModules == null) return {};
  if (
    typeof nodeModules !== "object" ||
    Array.isArray(nodeModules) ||
    Object.getPrototypeOf(nodeModules) !== Object.prototype
  ) {
    throw new ClientError(400, "Invalid dependency map");
  }
  const entries = Object.entries(nodeModules);
  if (entries.length > MAX_NODE_MODULES) {
    throw new ClientError(400, "Too many requested dependencies");
  }
  return Object.fromEntries(
    entries
      .map(([name, version]) => {
        if (
          !PACKAGE_NAME_PATTERN.test(name) ||
          typeof version !== "string" ||
          !PACKAGE_VERSION_PATTERN.test(version)
        ) {
          throw new ClientError(400, "Invalid dependency map");
        }
        return [name, version];
      })
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

function serializePayload(payload) {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized !== undefined && Buffer.byteLength(serialized) <= MAX_RESPONSE_BYTES) {
      return { body: serialized, exceeded: false };
    }
  } catch (error) {
    logInternalError("serialize response", error);
  }
  return {
    body: JSON.stringify({ error: "Response exceeded the maximum size", logs: [] }),
    exceeded: true,
  };
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  const serialized = serializePayload(payload);
  response.writeHead(serialized.exceeded ? 500 : statusCode, {
    "Content-Type": "application/json",
  });
  response.end(serialized.body);
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new ClientError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ClientError(400, "Malformed JSON request");
  }
}

function resolveTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(value, MAX_TIMEOUT_MS);
}

function awaitAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(signal.reason || new Error("Operation aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason || new Error("Operation aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function runNpmInstall(workDir, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
      ],
      {
        cwd: workDir,
        stdio: "ignore",
        env: {
          ...process.env,
          NPM_CONFIG_CACHE: join(MODULE_CACHE_DIR, "npm-cache"),
        },
      },
    );
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, new Error("npm install timed out"));
    }, NPM_INSTALL_TIMEOUT_MS);

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    }

    function onAbort() {
      child.kill("SIGKILL");
      settle(reject, signal.reason || new Error("npm install aborted"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) =>
      settle(reject, new Error(`Failed to spawn npm install: ${formatError(error)}`)),
    );
    child.once("close", (code) => {
      if (code === 0) settle(resolve);
      else settle(reject, new Error(`npm install failed with code ${code}`));
    });
  });
}

async function directorySize(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const childPath = join(path, entry.name);
    try {
      if (entry.isDirectory()) total += await directorySize(childPath);
      else total += (await lstat(childPath)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return total;
}

class DependencyCache {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.installPromises = new Map();
    this.protectedHashes = () => new Set();
    this.pruneTimer = null;
    this.pruneProtection = new Map();
  }

  setProtectedHashes(callback) {
    this.protectedHashes = callback;
  }

  schedulePrune() {
    if (this.pruneTimer) return;
    this.pruneTimer = setTimeout(async () => {
      this.pruneTimer = null;
      await this.prune();
    }, 1_000);
  }

  hold(hash) {
    if (!hash || hash === "default") return;
    this.pruneProtection.set(
      hash,
      (this.pruneProtection.get(hash) || 0) + 1,
    );
  }

  release(hash) {
    if (!hash || hash === "default") return;
    const count = this.pruneProtection.get(hash) || 0;
    if (count <= 1) this.pruneProtection.delete(hash);
    else this.pruneProtection.set(hash, count - 1);
  }

  async prune() {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      const now = Date.now();
      const candidates = [];
      for (const entry of entries) {
        const temporaryMatch = entry.name.match(/^([a-f0-9]{64})\.tmp-/);
        if (temporaryMatch) {
          if (!this.installPromises.has(temporaryMatch[1])) {
            await rm(join(this.rootDir, entry.name), {
              recursive: true,
              force: true,
            });
          }
          continue;
        }
        if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        if (
          this.protectedHashes().has(entry.name) ||
          this.pruneProtection.has(entry.name) ||
          this.installPromises.has(entry.name)
        ) {
          continue;
        }
        const path = join(this.rootDir, entry.name);
        const metadata = await lstat(path);
        const size = await directorySize(path);
        if (now - metadata.mtimeMs > MAX_CACHE_AGE_MS) {
          await rm(path, { recursive: true, force: true });
        } else {
          candidates.push({ path, size, mtimeMs: metadata.mtimeMs });
        }
      }
      let total = candidates.reduce((sum, candidate) => sum + candidate.size, 0);
      candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const candidate of candidates) {
        if (total <= MAX_CACHE_BYTES) break;
        await rm(candidate.path, { recursive: true, force: true });
        total -= candidate.size;
      }
      const npmCachePath = join(this.rootDir, "npm-cache");
      if (this.installPromises.size === 0) {
        try {
          if ((await directorySize(npmCachePath)) > MAX_NPM_CACHE_BYTES) {
            await rm(npmCachePath, { recursive: true, force: true });
            await mkdir(npmCachePath, { recursive: true });
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    } catch (error) {
      logInternalError("prune module cache", error);
    }
  }

  async get(nodeModules, signal) {
    const normalized = normalizeNodeModules(nodeModules);
    if (isSatisfiedByDefault(normalized)) {
      return {
        hash: "default",
        nodeModulesPath: DEFAULT_NODE_MODULES_DIR,
        isDefault: true,
        release: () => {},
      };
    }
    const hash = hashNodeModules(normalized);
    const nodeModulesPath = join(this.rootDir, hash, "node_modules");
    let state = this.installPromises.get(hash);
    if (!state) {
      const controller = new AbortController();
      const promise = this.ensureInstalled(
        join(this.rootDir, hash),
        normalized,
        controller.signal,
      ).finally(() => {
        this.schedulePrune();
        if (this.installPromises.get(hash)?.promise === promise) {
          this.installPromises.delete(hash);
        }
      });
      state = { controller, promise, waiters: 0 };
      this.installPromises.set(hash, state);
    }
    state.waiters++;
    try {
      await awaitAbort(state.promise, signal);
    } finally {
      state.waiters--;
      if (signal?.aborted && state.waiters === 0) {
        state.controller.abort(signal.reason);
      }
    }
    this.schedulePrune();
    this.hold(hash);
    let released = false;
    return {
      hash,
      nodeModulesPath,
      isDefault: false,
      release: () => {
        if (released) return;
        released = true;
        this.release(hash);
        this.schedulePrune();
      },
    };
  }

  async ensureInstalled(cachePath, nodeModules, signal) {
    const completeMarker = join(cachePath, ".complete");
    try {
      await readFile(completeMarker);
      return;
    } catch {
      // Rebuild an incomplete or interrupted install atomically below.
    }
    const tempPath = `${cachePath}.tmp-${randomUUID()}`;
    await rm(tempPath, { recursive: true, force: true });
    await mkdir(tempPath, { recursive: true });
    try {
      await writeFile(
        join(tempPath, "package.json"),
        JSON.stringify({
          private: true,
          type: "module",
          dependencies: nodeModules,
        }),
      );
      await runNpmInstall(tempPath, signal);
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
    this.creationPromises = new Map();
    this.drainingEntries = new Map();
  }

  async acquire(dependency, signal) {
    for (;;) {
      const entry = this.entries.get(dependency.hash);
      if (entry && !entry.retiring) {
        entry.activeJobs++;
        entry.lastUsed = performance.now();
        return entry;
      }
      if (
        !dependency.isDefault &&
        this.nonDefaultCount() >= MAX_NON_DEFAULT_RUNTIMES &&
        !this.hasSingleDrainingGeneration(dependency.hash) &&
        !(await this.evictInactiveRuntime())
      ) {
        await awaitAbort(this.waitForRuntime(), signal);
        continue;
      }
      let creation = this.creationPromises.get(dependency.hash);
      if (!creation) {
        creation = this.createEntry(dependency);
        this.creationPromises.set(dependency.hash, creation);
        const clearCreation = () => {
          if (this.creationPromises.get(dependency.hash) === creation) {
            this.creationPromises.delete(dependency.hash);
          }
        };
        creation.then(clearCreation, clearCreation);
      }
      await awaitAbort(creation, signal);
    }
  }

  async createEntry(dependency) {
    const options = {
      nodeModules: dependency.nodeModulesPath,
      permissions: {
        network: "allow",
        binding: BRIDGE_ENABLED ? "allow" : "deny",
      },
    };
    if (BRIDGE_ENABLED) {
      options.bindings = {
        "freestyle-host-fetch": {
          description: "Fetch on the configured development origin",
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
          timeoutMs: HOST_FETCH_TIMEOUT_MS,
          handler: hostFetch,
        },
      };
    }
    const runtime = await NodeRuntime.create(options);
    const entry = {
      hash: dependency.hash,
      isDefault: dependency.isDefault,
      nodeModulesPath: dependency.nodeModulesPath,
      runtime,
      activeJobs: 0,
      jobsHandled: 0,
      lastUsed: performance.now(),
      retiring: false,
      disposePromise: null,
    };
    this.entries.set(dependency.hash, entry);
    return entry;
  }

  evict(entry) {
    this.detach(entry);
  }

  disposeEntry(entry) {
    if (entry.disposePromise) return;
    entry.disposePromise = (async () => {
      try {
        await entry.runtime.dispose();
      } catch (error) {
        logInternalError("dispose detached runtime", error);
      } finally {
        const draining = this.drainingEntries.get(entry.hash);
        if (draining) {
          draining.delete(entry);
          if (draining.size === 0) this.drainingEntries.delete(entry.hash);
        }
      }
    })();
  }

  detach(entry) {
    // Retirement must never gate new jobs: waiting for a retiring runtime to
    // drain lets a single long-running job stall every later job on the same
    // node modules set. A detached entry keeps serving the jobs it already has
    // and is disposed by their last release, while new jobs immediately build
    // a replacement.
    entry.retiring = true;
    if (this.entries.get(entry.hash) === entry) {
      this.entries.delete(entry.hash);
    }
    // Track before disposing: a runtime is still alive while dispose() runs, so
    // it has to stay visible to the capacity accounting until disposeEntry()
    // untracks it.
    let draining = this.drainingEntries.get(entry.hash);
    if (!draining) {
      draining = new Set();
      this.drainingEntries.set(entry.hash, draining);
    }
    draining.add(entry);
    if (entry.activeJobs === 0) this.disposeEntry(entry);
  }

  async evictInactiveRuntime() {
    const candidate = [...this.entries.values()]
      .filter(
        (entry) =>
          !entry.isDefault && entry.activeJobs === 0 && !entry.retiring,
      )
      .sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!candidate) return false;
    this.entries.delete(candidate.hash);
    try {
      await candidate.runtime.dispose();
    } catch (error) {
      logInternalError("dispose evicted runtime", error);
    }
    return true;
  }

  release(entry) {
    entry.activeJobs--;
    if (entry.retiring) {
      if (entry.activeJobs === 0) this.disposeEntry(entry);
      return;
    }
    entry.jobsHandled++;
    entry.lastUsed = performance.now();
    if (entry.jobsHandled >= MAX_JOBS_PER_RUNTIME) {
      this.detach(entry);
    }
  }

  retire(entry) {
    this.detach(entry);
  }

  hasSingleDrainingGeneration(hash) {
    const draining = this.drainingEntries.get(hash);
    return draining?.size === 1;
  }

  nonDefaultCount() {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!entry.isDefault) count++;
    }
    for (const draining of this.drainingEntries.values()) {
      for (const entry of draining) {
        if (!entry.isDefault) count++;
      }
    }
    for (const hash of this.creationPromises.keys()) {
      if (hash !== "default") count++;
    }
    return count;
  }

  protectedHashes() {
    return new Set([
      ...this.entries.keys(),
      ...this.drainingEntries.keys(),
      ...this.creationPromises.keys(),
    ]);
  }

  async waitForRuntime() {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createOutput() {
  return {
    stdout: "",
    stderr: "",
    decoders: { stdout: new TextDecoder(), stderr: new TextDecoder() },
    finalized: false,
    truncated: { stdout: false, stderr: false },
  };
}

function appendOutput(output, stream, chunk) {
  const decoded = output.decoders[stream].decode(chunk, { stream: true });
  appendOutputText(output, stream, decoded);
}

function appendOutputText(output, stream, decoded) {
  const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(output[stream]);
  if (remaining <= 0) {
    output.truncated[stream] = true;
    return;
  }
  const bytes = Buffer.from(decoded);
  if (bytes.byteLength > remaining) {
    output[stream] += bytes.subarray(0, remaining).toString("utf8");
    output.truncated[stream] = true;
  } else {
    output[stream] += decoded;
  }
}

function finalizeOutput(output) {
  if (output.finalized) return;
  for (const stream of ["stdout", "stderr"]) {
    appendOutputText(
      output,
      stream,
      output.decoders[stream].decode(new Uint8Array()),
    );
    if (output.truncated[stream]) output[stream] += "\n[output truncated]";
  }
  output.finalized = true;
}

function logsFromOutput(output) {
  finalizeOutput(output);
  return [
    ...output.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((message) => ({ message, type: "log" })),
    ...output.stderr
      .split(/\r?\n/)
      .filter(Boolean)
      .map((message) => ({ message, type: "error" })),
  ];
}

function truncateResult(result) {
  if (result === undefined) return undefined;
  try {
    const serialized = JSON.stringify(result);
    if (serialized === undefined) return result;
    if (Buffer.byteLength(serialized) <= MAX_RESULT_BYTES) return result;
  } catch {
    return "[result could not be serialized]";
  }
  return `[result truncated after ${MAX_RESULT_BYTES} bytes]`;
}

function makeCleanupWrapper(userModuleDir) {
  return `
try {
  const fs = await import("node:fs/promises");
  await fs.chmod(${JSON.stringify(userModuleDir)}, 0o700).catch(() => {});
  await fs.rm(${JSON.stringify(userModuleDir)}, { recursive: true, force: true });
} catch {}
`;
}

function makeWrapper(userModulePath, userModuleDir) {
  const bridgeSource = BRIDGE_ENABLED
    ? `
const bridgedOrigins = ${JSON.stringify(BRIDGED_ORIGINS)};
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
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
const canonicalOrigin = (url) => {
  if (url.username || url.password || !url.port) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.protocol + "//" + url.hostname.toLowerCase().replace(/\\.$/, "") + ":" + url.port;
};
const resolveRedirectUrl = (location, current) => {
  const value = String(location).trim();
  if (/^[a-z][a-z\\d+.-]*:/i.test(value)) return value;
  if (value.startsWith("//")) return current.protocol + value;
  const hashIndex = value.indexOf("#");
  const queryIndex = value.indexOf("?");
  const suffixIndex = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const path = suffixIndex === undefined ? value : value.slice(0, suffixIndex);
  const suffix = suffixIndex === undefined ? "" : value.slice(suffixIndex);
  if (path === "") {
    if (value.startsWith("?")) return current.origin + current.pathname + suffix;
    return current.origin + current.pathname + current.search + suffix;
  }
  const basePath = path.startsWith("/")
    ? path
    : current.pathname.slice(0, current.pathname.lastIndexOf("/") + 1) + path;
  const segments = [];
  for (const segment of basePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return current.origin + "/" + segments.join("/") + suffix;
};
const bridgedFetch = async (input, init) => {
  let request = new Request(input, init);
  for (let redirectCount = 0; ; redirectCount++) {
    const target = new URL(request.url);
    if (!bridgedOrigins.includes(canonicalOrigin(target))) {
      return originalFetch(request);
    }
    const method = request.method.toUpperCase();
    let bodyBytes = null;
    if (method !== "GET" && method !== "HEAD") {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
      if (bodyBytes.byteLength > ${MAX_BRIDGE_BODY_BYTES}) {
        throw new Error("Request body exceeds the bridge limit");
      }
    }
    const bridged = await globalThis.callBinding("freestyle-host-fetch", {
      url: request.url,
      method,
      headers: Object.fromEntries(
        [...request.headers].filter(([name]) => !${JSON.stringify([...HOP_BY_HOP_HEADERS])}.includes(name)),
      ),
      bodyBase64: bodyBytes && encodeBase64(bodyBytes),
    });
    const makeResponse = (url = request.url) => {
      const responseBody = bridged.status === 204 ||
        bridged.status === 205 ||
        bridged.status === 304
        ? undefined
        : decodeBase64(bridged.bodyBase64);
      const response = new Response(responseBody, {
        status: bridged.status,
        statusText: bridged.statusText,
        headers: bridged.headers,
      });
      Object.defineProperty(response, "url", {
        configurable: true,
        value: url,
      });
      return response;
    };
    const location = bridged.headers?.location;
    if (
      location &&
      [301, 302, 303, 307, 308].includes(bridged.status)
    ) {
      if (request.redirect === "manual") return makeResponse();
      if (request.redirect === "error") {
        throw new TypeError("Redirect disallowed by request redirect mode");
      }
      // Bound guest-controlled redirect chains while revalidating every hop
      // through hostFetch so redirects cannot bypass the bridge allowlist.
      if (redirectCount >= ${MAX_BRIDGE_REDIRECTS}) {
        throw new Error("Maximum bridge redirect limit exceeded");
      }
      const redirectUrl = resolveRedirectUrl(location, target);
      const redirectMethod =
        [301, 302, 303].includes(bridged.status) &&
        method !== "GET" &&
        method !== "HEAD"
          ? "GET"
          : method;
      const redirectHeaders =
        redirectMethod === "GET" && method !== "GET"
          ? Object.fromEntries(
              [...request.headers].filter(
                ([name]) =>
                  ![
                    "content-length",
                    "content-type",
                    "content-encoding",
                    "content-language",
                    "content-location",
                  ].includes(name),
              ),
            )
          : request.headers;
      request = new Request(redirectUrl, {
        method: redirectMethod,
        headers: redirectHeaders,
        ...(redirectMethod === "GET" || redirectMethod === "HEAD"
          ? {}
          : { body: bodyBytes, duplex: "half" }),
      });
      continue;
    }
    return makeResponse();
  }
};
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  // This shim only routes convenience fetches; hostFetch enforces the boundary.
  writable: true,
  value: bridgedFetch,
});
`
    : "";
  return `
const logs = [];
const MAX_LOG_ENTRIES = 1000;
const MAX_LOG_MESSAGE_BYTES = 64 * 1024;
let logBytes = 0;
const inspectValue = (value) => {
  try {
    return JSON.stringify(value, (_, nested) =>
      typeof nested === "bigint" ? nested.toString() + "n" : nested,
    ) ?? String(value);
  } catch {
    try { return Object.prototype.toString.call(value); } catch { return "<uninspectable>"; }
  }
};
// Guest code can forge or suppress these logs; they are untrusted data.
for (const type of ["log", "info", "warn", "error", "debug"]) {
  const original = console[type];
  console[type] = (...args) => {
    if (logs.length < MAX_LOG_ENTRIES) {
      const values = [];
      for (const arg of args) values.push(inspectValue(arg));
      let message = values.join(" ");
      const encoder = new TextEncoder();
      let encoded = encoder.encode(message);
      if (encoded.byteLength > MAX_LOG_MESSAGE_BYTES) {
        const marker = " [log truncated]";
        const budget = MAX_LOG_MESSAGE_BYTES - encoder.encode(marker).byteLength;
        let truncated = new TextDecoder().decode(encoded.subarray(0, budget));
        while (encoder.encode(truncated).byteLength > budget) {
          truncated = truncated.slice(0, -1);
        }
        message = truncated + marker;
        encoded = encoder.encode(message);
      }
      const messageBytes = encoded.byteLength;
      if (logBytes + messageBytes <= ${MAX_RESULT_BYTES}) {
        logs.push({ message, type });
        logBytes += messageBytes;
      }
    }
    original(...args);
  };
}
${bridgeSource}
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
} finally {
  try {
    const fs = await import("node:fs/promises");
    await fs.rm(${JSON.stringify(userModuleDir)}, { recursive: true, force: true });
  } catch {}
}
`;
}

async function hostFetch(input) {
  const url = isAllowedBridgeUrl(input.url);
  if (!url) throw new Error("Host callback origin is not allowed");
  const headers = Object.fromEntries(
    Object.entries(input.headers || {}).filter(
      ([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase()),
    ),
  );
  const requestInit = {
    method: String(input.method || "GET").toUpperCase(),
    headers,
    redirect: "manual",
  };
  if (input.bodyBase64 != null) {
    const body = Buffer.from(input.bodyBase64, "base64");
    if (body.byteLength > MAX_BRIDGE_BODY_BYTES) {
      throw new Error("Request body exceeds the bridge limit");
    }
    requestInit.body = body;
  }
  const controller = new AbortController();
  // The job watchdog is authoritative; this only prevents a callback from
  // surviving past the maximum job lifetime if its runtime is not retired.
  const timer = setTimeout(() => controller.abort(), HOST_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...requestInit,
      signal: controller.signal,
    });
    let body = Buffer.alloc(0);
    if (response.body && response.status !== 204 && response.status !== 304) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BRIDGE_RESPONSE_BYTES) {
          controller.abort();
          throw new Error("Response body exceeds the bridge limit");
        }
        chunks.push(Buffer.from(value));
      }
      body = Buffer.concat(chunks);
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(
        [...response.headers].filter(
          ([name]) => !STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase()),
        ),
      ),
      bodyBase64: body.toString("base64"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function cleanupGuestFiles(runtime, userModuleDir) {
  try {
    await runtime.run(makeCleanupWrapper(userModuleDir), { timeout: 2_000 });
  } catch (error) {
    logInternalError("cleanup guest source", error);
    // Cleanup cannot change the already-produced response, but a dead runtime
    // must still be reported so the queue can evict it for the next request.
    if (isDeadRuntimeError(error)) return error;
  }
  return null;
}

async function executeScript(runtime, job) {
  const userModuleDir = `${USER_MODULE_DIR}/${randomUUID()}`;
  const userModulePath = `${userModuleDir}/user.mjs`;
  await runtime.writeFile(userModulePath, job.script);
  let result;
  try {
    result = await runtime.run(makeWrapper(userModulePath, userModuleDir), {
      env: job.config.envVars || {},
      timeout: job.timeoutMs,
      signal: job.controller.signal,
      onStdout: (chunk) => appendOutput(job.output, "stdout", chunk),
      onStderr: (chunk) => appendOutput(job.output, "stderr", chunk),
    });
  } catch (error) {
    logInternalError("secure-exec execution", error);
    if (isDeadRuntimeError(error)) throw error;
    return {
      statusCode: 500,
      payload: {
        error: "Script execution failed",
        logs: logsFromOutput(job.output),
      },
    };
  } finally {
    job.cleanupError = await cleanupGuestFiles(runtime, userModuleDir);
  }
  if (result.exitCode !== 0 || result.value === undefined) {
    logInternalError("secure-exec nonzero exit", result.stderr || result.exitCode);
    return {
      statusCode: 500,
      payload: {
        error: "Script execution failed",
        logs: logsFromOutput(job.output),
      },
    };
  }
  if (result.value.status === "error") {
    return {
      statusCode: 500,
      payload: { error: result.value.error, logs: result.value.logs },
    };
  }
  return {
    statusCode: 200,
    payload: {
      result: truncateResult(result.value.result),
      logs: result.value.logs,
    },
  };
}

class JobQueue {
  constructor(runtimeCache, dependencyCache) {
    this.runtimeCache = runtimeCache;
    this.dependencyCache = dependencyCache;
    this.queue = [];
    this.activeJobs = 0;
  }

  submit(script, config, timeoutMs) {
    if (this.queue.length >= MAX_QUEUE_DEPTH) throw new QueueFullError();
    return new Promise((resolve) => {
      this.queue.push({
        script,
        config,
        timeoutMs,
        controller: new AbortController(),
        output: createOutput(),
        entry: null,
        cleanupError: null,
        timer: null,
        settled: false,
        resolve,
      });
      requestMetrics.maxQueueDepth = Math.max(
        requestMetrics.maxQueueDepth,
        this.queue.length,
      );
      this.dispatch();
    });
  }

  settle(job, result) {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearTimeout(job.timer);
    job.resolve(result);
  }

  armPreparationTimeout(job) {
    job.timer = setTimeout(() => {
      job.controller.abort(new Error("Dependency preparation timed out"));
      this.settle(job, {
        statusCode: 500,
        payload: {
          error: "Dependency preparation timed out",
          logs: logsFromOutput(job.output),
        },
      });
    }, PREPARATION_TIMEOUT_MS);
  }

  armExecutionTimeout(job) {
    job.timer = setTimeout(() => {
      if (job.entry) this.runtimeCache.retire(job.entry);
      job.controller.abort(new Error("Execution timed out"));
      this.settle(job, {
        statusCode: 500,
        payload: {
          error: "Script execution timed out",
          logs: logsFromOutput(job.output),
        },
      });
    }, job.timeoutMs + OUTER_TIMEOUT_GRACE_MS);
  }

  dispatch() {
    while (this.activeJobs < MAX_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift();
      this.activeJobs++;
      this.armPreparationTimeout(job);
      this.execute(job)
        .then((result) => this.settle(job, result))
        .catch((error) => {
          logInternalError("execute job", error);
          this.settle(job, {
            statusCode: 500,
            payload: {
              error: "Script execution failed",
              logs: logsFromOutput(job.output),
            },
          });
        })
        .finally(() => {
          this.activeJobs--;
          this.dispatch();
        });
    }
  }

  async execute(job) {
    let entry;
    let dependency;
    let executionError = null;
    try {
      dependency = await this.dependencyCache.get(
        job.config.nodeModules,
        job.controller.signal,
      );
      if (job.settled || job.controller.signal.aborted) return null;
      entry = await this.runtimeCache.acquire(
        dependency,
        job.controller.signal,
      );
      // Preparation can finish after the preparation watchdog already settled
      // the response; never hand a settled job to the guest or arm a timer for
      // it, or a late timer would retire a healthy runtime.
      if (job.settled || job.controller.signal.aborted) return null;
      job.entry = entry;
      if (job.timer) clearTimeout(job.timer);
      this.armExecutionTimeout(job);
      return await executeScript(entry.runtime, job);
    } catch (error) {
      executionError = error;
      throw error;
    } finally {
      if (
        entry &&
        (job.cleanupError || isDeadRuntimeError(executionError))
      ) {
        this.runtimeCache.evict(entry);
      }
      if (entry) this.runtimeCache.release(entry);
      dependency?.release();
    }
  }
}

const dependencyCache = new DependencyCache(MODULE_CACHE_DIR);
const runtimeCache = new RuntimeCache();
dependencyCache.setProtectedHashes(() => runtimeCache.protectedHashes());
const jobQueue = new JobQueue(runtimeCache, dependencyCache);

await mkdir(MODULE_CACHE_DIR, { recursive: true });
await dependencyCache.prune();
const defaultEntry = await runtimeCache.acquire({
  hash: "default",
  isDefault: true,
  nodeModulesPath: DEFAULT_NODE_MODULES_DIR,
});
runtimeCache.release(defaultEntry);

const server = createServer(async (request, response) => {
  const requestStartedAt = performance.now();
  let trackedRequest = false;
  try {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`,
    );
    if (request.method === "GET" && url.pathname === "/diagnostics") {
      const responseBody = JSON.stringify(readRequestMetrics());
      if (url.searchParams.get("reset") === "true") resetRequestMetrics();
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(responseBody);
      return;
    }
    const isExecutePath =
      request.method === "POST" &&
      /^\/execute\/v[123]\/script$/.test(url.pathname);
    if (!isExecutePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    trackedRequest = true;
    requestMetrics.requests++;
    requestMetrics.active++;
    const body = await readRequestBody(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.script !== "string"
    ) {
      throw new ClientError(400, "Request body must contain a string script");
    }
    const config =
      body.config && typeof body.config === "object" && !Array.isArray(body.config)
        ? body.config
        : {};
    config.nodeModules = normalizeNodeModules(config.nodeModules);
    const timeoutMs = resolveTimeout(config.timeout);
    const result = await jobQueue.submit(body.script, config, timeoutMs);
    sendJson(response, result.statusCode, result.payload);
  } catch (error) {
    if (error instanceof ClientError) {
      sendJson(response, error.statusCode, { error: error.message, logs: [] });
      return;
    }
    logInternalError("request", error);
    sendJson(response, 500, { error: "Internal server error", logs: [] });
  } finally {
    if (trackedRequest) recordRequestDuration(performance.now() - requestStartedAt);
  }
});

server.listen(PORT, () => {
  console.log(
    `freestyle-mock listening on :${PORT} (bridge ${
      BRIDGE_ENABLED ? BRIDGED_ORIGINS.join(",") : "disabled"
    })`,
  );
});
