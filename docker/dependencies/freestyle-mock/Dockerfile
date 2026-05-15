FROM node:22-slim

# ---- app setup --------------------------------------------------------------
WORKDIR /app

# Create package.json for global dependencies
RUN cat <<'EOF' > package.json
{
  "name": "freestyle-mock",
  "type": "module",
  "dependencies": {
    "arktype": "2.1.20",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "@react-email/components": "1.0.6"
  }
}
EOF

# Install global dependencies
RUN npm install

# Worker thread that executes a single user script at a time.
# The pool guarantees one in-flight job per worker via its `busy` flag
RUN cat <<'EOF' > worker.mjs
import { parentPort } from "worker_threads";

if (!parentPort) {
  throw new Error("worker.mjs must be spawned as a worker thread");
}

const logMethods = ["log", "info", "warn", "error", "debug"];
const originalConsole = Object.fromEntries(logMethods.map((m) => [m, console[m]]));

parentPort.on("message", async ({ scriptFile, envVars }) => {
  const logs = [];

  logMethods.forEach((method) => {
    console[method] = (...args) => {
      logs.push({ message: args.map(String).join(" "), type: method });
      originalConsole[method](...args);
    };
  });

  // Snapshot the FULL env, not just the keys we're about to set. Workers are
  // reused across jobs (up to MAX_JOBS_PER_WORKER), so any unrelated mutation
  // user code makes — `process.env.FOO = "x"`, `delete process.env.PATH`, etc.
  // — would otherwise leak to the next job on this worker. Per-job isolation
  // has to be total.
  const envSnapshot = { ...process.env };
  Object.entries(envVars || {}).forEach(([key, value]) => {
    process.env[key] = value;
  });

  let response;
  try {
    const userModule = await import(`file://${scriptFile}`);
    const userFunction = userModule.default ?? userModule;
    const result = await (typeof userFunction === "function" ? userFunction() : userFunction);
    response = { status: "ok", result, logs };
  } catch (err) {
    response = { status: "error", error: err?.message || String(err), logs };
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
      process.env[key] = value;
    }
    logMethods.forEach((method) => {
      console[method] = originalConsole[method];
    });
  }

  parentPort.postMessage(response);
});
EOF

# Main HTTP server: accepts requests, prepares the workdir / installs deps,
# then dispatches the actual script execution to a worker_threads pool so that
# CPU-bound work (React + react-email rendering) runs in parallel across cores.
RUN cat <<'EOF' > server.mjs
import { createServer } from "http";
import { mkdir, writeFile, rm } from "fs/promises";
import { join, dirname } from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { cpus } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname, "worker.mjs");

const preinstalledNodeModules = new Map([
  ["arktype", "2.1.20"],
  ["react-dom", "19.1.1"],
  ["react", "19.1.1"],
  ["@react-email/components", "1.0.6"],
]);
const baseWorkDir = "/app/tmp";

// Pool size = available CPUs (clamped >= 2). os.cpus() is the right knob since
// rendering is CPU-bound; if a CI container's --cpus limit makes this lie, the
// worst case is a few extra workers contending — not worth a tuning knob.
const POOL_SIZE = Math.max(2, cpus().length);

// Each unique bundled script becomes a unique import in the worker's V8 module
// cache, which would otherwise grow without bound. Recycle workers periodically
// to cap that. 50 is arbitrary; high enough to amortize worker startup +
// react/react-email warm-up, low enough to keep RSS bounded under sustained load.
const MAX_JOBS_PER_WORKER = 50;

// Per-job timeout. Without this, a hung user script (infinite loop, unresolved
// await) would keep slot.busy=true forever, the pool would silently shrink,
// and we'd reproduce the original starvation problem. 30s is far longer than
// any legitimate email render but short enough to bound damage. Note: this
// also implicitly bounds the queue (queue length <= rps * timeout), so we
// don't add a separate queue cap.
const JOB_TIMEOUT_MS = 30_000;

// Worker pool. Each slot owns one Worker that handles at most one job at a time;
// concurrency comes from running many slots in parallel, not from interleaving
// jobs inside a single worker (which would re-introduce global-state races on
// console / process.env, since parentPort doesn't serialize async handlers).
class WorkerPool {
  constructor(size) {
    this.slots = [];
    this.queue = [];
    for (let i = 0; i < size; i++) {
      this.slots.push(this.spawnSlot());
    }
  }

  spawnSlot() {
    const slot = {
      worker: null,
      busy: false,
      draining: false,
      jobsHandled: 0,
      currentJob: null,
      currentResolve: null,
      currentReject: null,
    };
    const worker = new Worker(workerScript);
    slot.worker = worker;

    // Marks the slot as both not-busy AND draining: any error/exit means the
    // worker is unusable (Node will terminate it after 'error', and 'exit' is
    // fatal by definition). Setting draining here closes the race where
    // dispatchNext would otherwise see !busy and assign a new job between the
    // 'error' and 'exit' events, only for that job to be dropped on the floor.
    // The 'exit' handler is the sole path that returns capacity to the pool
    // (by spawning a replacement slot).
    const failInFlight = (err) => {
      slot.draining = true;
      const reject = slot.currentReject;
      slot.currentResolve = null;
      slot.currentReject = null;
      slot.currentJob = null;
      slot.busy = false;
      if (reject) reject(err);
    };

    worker.on("message", (msg) => {
      const resolve = slot.currentResolve;
      slot.currentResolve = null;
      slot.currentReject = null;
      slot.currentJob = null;
      slot.busy = false;
      slot.jobsHandled++;
      if (resolve) resolve(msg);

      if (slot.jobsHandled >= MAX_JOBS_PER_WORKER) {
        // Recycle: mark draining so dispatchNext skips this slot, then
        // terminate. The 'exit' handler will spawn the replacement.
        slot.draining = true;
        slot.worker.terminate();
      }
      this.dispatchNext();
    });

    worker.on("error", (err) => {
      failInFlight(err);
    });

    worker.on("exit", (code) => {
      // Settle any in-flight promise on ANY exit. A clean recycle has no
      // in-flight job (draining was set before terminate), so this is a no-op
      // then. But it correctly handles user-script process.exit(0), OOM kills,
      // and timeout-triggered terminations.
      failInFlight(new Error(`Freestyle mock worker exited (code ${code}) before completing job`));

      const idx = this.slots.indexOf(slot);
      if (idx !== -1) {
        this.slots[idx] = this.spawnSlot();
        this.dispatchNext();
      }
    });

    return slot;
  }

  dispatchNext() {
    while (this.queue.length > 0) {
      const idle = this.slots.find((s) => !s.busy && !s.draining);
      if (!idle) return;
      const job = this.queue.shift();
      idle.busy = true;
      idle.currentJob = job;
      idle.currentResolve = job.resolve;
      idle.currentReject = job.reject;
      idle.worker.postMessage(job.payload);
    }
  }

  run(payload) {
    return new Promise((resolveOuter, rejectOuter) => {
      let settled = false;
      const settleResolve = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveOuter(v);
      };
      const settleReject = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectOuter(e);
      };

      const job = { payload, resolve: settleResolve, reject: settleReject };

      const timer = setTimeout(() => {
        const slot = this.slots.find((s) => s.currentJob === job);
        if (slot) {
          // In flight: terminate the worker. The 'exit' handler will run
          // failInFlight, but our `settled` guard makes that a no-op (we've
          // already rejected with the more useful timeout message).
          slot.draining = true;
          slot.worker.terminate();
        } else {
          // Still queued: remove so dispatchNext doesn't pick it up later.
          const idx = this.queue.indexOf(job);
          if (idx !== -1) this.queue.splice(idx, 1);
        }
        settleReject(new Error(
          `Freestyle mock job timed out after ${JOB_TIMEOUT_MS}ms ` +
          `(${slot ? "while running" : "while queued"})`,
        ));
      }, JOB_TIMEOUT_MS);

      this.queue.push(job);
      this.dispatchNext();
    });
  }
}

const pool = new WorkerPool(POOL_SIZE);

// npm install timeout. A slow/unreachable registry would otherwise hold the
// HTTP request open indefinitely. 60s allows for cold-cache fetches.
const NPM_INSTALL_TIMEOUT_MS = 60_000;

async function runNpmInstall(workDir) {
  return new Promise((resolve, reject) => {
    // stdio: "ignore" rather than "pipe" because nothing here reads from the
    // pipes; an unread stdout/stderr would fill the OS pipe buffer (~64KB on
    // Linux), npm would block on write, 'close' would never fire, and the
    // request would hang forever.
    const installProcess = spawn("npm", ["install"], {
      cwd: workDir,
      stdio: "ignore",
    });

    let settled = false;
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    const timer = setTimeout(() => {
      installProcess.kill("SIGKILL");
      settle(reject, new Error(`npm install timed out after ${NPM_INSTALL_TIMEOUT_MS}ms`));
    }, NPM_INSTALL_TIMEOUT_MS);

    // Required: a child_process 'error' event with no listener is rethrown as
    // an uncaught exception by EventEmitter, which would crash the entire
    // mock server on any spawn failure (ENOENT, EACCES, etc.).
    installProcess.on("error", (err) => {
      settle(reject, new Error(`Failed to spawn npm install: ${err?.message || err}`));
    });

    installProcess.on("close", (code) => {
      if (code === 0) settle(resolve);
      else settle(reject, new Error(`npm install failed with code ${code}`));
    });
  });
}

const server = createServer(async (req, res) => {
  // Wrap the entire handler in a guaranteed-response try/catch. Node's HTTP
  // server doesn't auto-send a 500 when an async handler rejects — the socket
  // just gets dropped — which would leave clients hanging until their own
  // timeout. Every error path below this point must end with a sent response.
  let workDir = null;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const isValidEndpoint = req.method === "POST" && (url.pathname === "/execute/v1/script" || url.pathname === "/execute/v2/script");

    if (!isValidEndpoint) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    const { script, config = {} } = JSON.parse(body);

    await mkdir(baseWorkDir, { recursive: true });
    workDir = join(baseWorkDir, "job-" + randomUUID());
    await mkdir(workDir, { recursive: true });

    const scriptFile = join(workDir, "script.mjs");
    await writeFile(scriptFile, script);

    const packageJson = {
      type: "module",
      dependencies: config.nodeModules || {},
    };
    const packageJsonFile = join(workDir, "package.json");
    await writeFile(packageJsonFile, JSON.stringify(packageJson, null, 2));

    const requestedNodeModules = config.nodeModules || {};
    const needsInstall = Object.entries(requestedNodeModules).some(([name, version]) => {
      return preinstalledNodeModules.get(name) !== version;
    });

    if (needsInstall && Object.keys(requestedNodeModules).length) {
      await runNpmInstall(workDir);
    }

    const response = await pool.run({
      scriptFile,
      envVars: config.envVars || {},
    });

    // Serialize BEFORE writeHead. The worker's postMessage uses structured
    // cloning, which is a strict superset of JSON: it can transfer BigInts,
    // Maps, Sets, and circular references that JSON.stringify chokes on.
    // If we wrote headers first, a stringify throw here would leave us with
    // headers sent and no body — the client would see a misleading 200/empty.
    // Doing it in this order lets the outer catch send a clean 500 instead.
    const status = response.status === "ok" ? 200 : 500;
    const payload = response.status === "ok"
      ? { result: response.result, logs: response.logs }
      : { error: response.error, logs: response.logs };
    const responseBody = JSON.stringify(payload);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(responseBody);
  } catch (err) {
    // Defensive: only send if we haven't started a response. Errors from
    // res.end itself (closed socket, etc.) shouldn't double-send.
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    } else {
      try { res.end(); } catch { /* socket already gone */ }
    }
  } finally {
    if (workDir) {
      try { await rm(workDir, { recursive: true }); } catch { /* ignore */ }
    }
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`freestyle-mock listening on :${PORT} (worker pool size ${POOL_SIZE})`);
});
EOF

# ---- network ----------------------------------------------------------------
EXPOSE 8080

# ---- launch -----------------------------------------------------------------
CMD ["node", "server.mjs"]
