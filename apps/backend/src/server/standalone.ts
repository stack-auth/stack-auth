import { closeBackendInstrumentation } from "@/instrument";
import { getTrustedProxy } from "@/lib/trusted-proxy";
import "@/polyfills";
import { disconnectPostgresPrismaClients } from "@/prisma-client";
import { drainInFlightPromises } from "@/utils/background-tasks";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { Server as ElysiaServer } from "elysia/universal";
import { app } from "./app";
import { backendShutdownBudget, runShutdownOperationWithTimeout, shutdownBackend } from "./shutdown";

const portPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
const port = Number(getEnvVariable("PORT", getEnvVariable("BACKEND_PORT", `${portPrefix}02`)));
const hostname = getEnvVariable("HEXCLAVE_BACKEND_HOST", "0.0.0.0");
const trustedProxy = getTrustedProxy();

// The @elysia/node adapter never assigns `app.server`, so `app.stop()` falls through to the
// web-standard adapter's stop and throws "Elysia isn't running" even while the server is serving
// traffic. The adapter instead hands a working server handle (whose stop() closes the underlying
// Node http.Server) to the listen callback, so capture that and use it for graceful shutdown.
const listenOptions = {
  hostname,
  port,
  // srvx only uses forwarded protocol/host metadata when the immediate peer is
  // trusted. The deployment setting must only be enabled when direct access to
  // the origin is blocked; otherwise clients could spoof HTTPS and host values.
  trustProxy: trustedProxy !== "",
};
const boundServerPromise = new Promise<ElysiaServer>((resolve) => {
  app.listen(listenOptions, (server) => {
    resolve(server);
  });
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
      timeoutMs: backendShutdownBudget.hardExitTimeoutMs,
    }));
    process.exit(1);
  }, backendShutdownBudget.hardExitTimeoutMs);
  shutdownPromise = shutdownBackend(signal, {
    // stop(false) mirrors the previous app.stop(false) intent: stop accepting new connections but
    // let in-flight requests finish (the drain steps below and the hard-exit cover the rest).
    stopAcceptingRequests: async () => (await boundServerPromise).stop(false),
    drainBackgroundTasks: async () => await drainInFlightPromises(backendShutdownBudget.backgroundTasksTimeoutMs),
    disconnectDatabases: async () => await runShutdownOperationWithTimeout(
      "database disconnect",
      backendShutdownBudget.databaseTimeoutMs,
      disconnectPostgresPrismaClients,
    ),
    closeInstrumentation: async () => await closeBackendInstrumentation(backendShutdownBudget.instrumentationTimeoutMs),
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
