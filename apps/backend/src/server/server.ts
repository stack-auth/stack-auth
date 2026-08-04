import { closeBackendInstrumentation } from "@/instrument";
import "@/polyfills";
import { disconnectPostgresPrismaClients } from "@/prisma-client";
import { drainInFlightPromises } from "@/utils/background-tasks";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { Server as ElysiaServer } from "elysia/universal";
import { app } from "./app";
import "./env-expand";
import { shutdownBackend } from "./shutdown";

const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
const port = Number(getEnvVariable("PORT", getEnvVariable("BACKEND_PORT", `${portPrefix}02`)));
const hostname = getEnvVariable("HOSTNAME", "0.0.0.0");

// The @elysiajs/node adapter never assigns `app.server`, so `app.stop()` falls through to the
// web-standard adapter's stop and throws "Elysia isn't running" even while the server is serving
// traffic. The adapter instead hands a working server handle (whose stop() closes the underlying
// Node http.Server) to the listen callback, so capture that and use it for graceful shutdown.
let boundServer: ElysiaServer | undefined;
app.listen({
  hostname,
  port,
}, (server) => {
  boundServer = server;
});

console.log(`Hexclave backend listening on http://${hostname}:${port}`);

let shutdownPromise: Promise<void> | undefined;

function handleShutdownSignal(signal: NodeJS.Signals) {
  if (shutdownPromise != null) {
    console.error(JSON.stringify({
      event: "backend.shutdown.forced",
      signal,
    }));
    process.exit(1);
  }

  const hardExitTimeout = setTimeout(() => {
    console.error(JSON.stringify({
      event: "backend.shutdown.timed-out",
      signal,
      timeoutMs: 15_000,
    }));
    process.exit(1);
  }, 15_000);
  hardExitTimeout.unref();

  shutdownPromise = shutdownBackend(signal, {
    // stop(false) mirrors the previous app.stop(false) intent: stop accepting new connections but
    // let in-flight requests finish (the drain steps below and the 15s hard-exit cover the rest).
    stopAcceptingRequests: async () => (boundServer ?? throwErr("HTTP server handle missing — the listen callback should have run at startup")).stop(false),
    drainBackgroundTasks: async () => await drainInFlightPromises(8000),
    disconnectDatabases: disconnectPostgresPrismaClients,
    closeInstrumentation: closeBackendInstrumentation,
    log: (event) => {
      const serializedEvent = JSON.stringify(event);
      if (event.event === "backend.shutdown.failed") {
        console.error(serializedEvent);
      } else {
        console.log(serializedEvent);
      }
    },
  }).then(() => {
    clearTimeout(hardExitTimeout);
    // All owned resources have been drained; exit explicitly so an unknown
    // third-party handle cannot extend a container termination indefinitely.
    process.exit(0);
  });

  runAsynchronously(shutdownPromise, {
    noErrorLogging: true,
    onError: (error) => {
      console.error(JSON.stringify({
        event: "backend.shutdown.unhandled-error",
        signal,
        error: error.message,
      }));
      process.exit(1);
    },
  });
}

process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));
process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
