#!/usr/bin/env node
/**
 * In-container cron runner for the Hexclave self-host image on Railway.
 *
 * Hexclave's scheduled work (email queue, external DB sync, workflow engine,
 * growth watchdog) runs on Vercel Cron in the hosted product: plain HTTP GETs
 * against internal endpoints, authorised with CRON_SECRET. Self-hosting has no
 * scheduler, so a Railway deployment previously needed a separate service that
 * curled a hand-written list of those endpoints.
 *
 * Two reasons this lives in-process instead:
 *
 *  1. The schedule is read from apps/backend/vercel.json — the same file the
 *     backend itself imports (src/server/cron-monitor.ts) — so it cannot drift.
 *     A hand-maintained list silently goes stale whenever upstream adds a cron,
 *     which is exactly what happened before: two of the five crons never ran.
 *
 *  2. Most of these are `* * * * *`. A Railway cron service cold-starts a
 *     container per firing, which at one-minute granularity means ~1,440
 *     container starts a day for work that takes milliseconds.
 */

import http from "node:http";
import { loadCrons, matches } from "./cron-schedule.mjs";

const UPSTREAM_HOST = "127.0.0.1";
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8102);
const SCHEDULE_PATH = process.env.HEXCLAVE_RAILWAY_CRON_SCHEDULE_PATH || "/railway/vercel.json";
const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * Caps a single firing. workflow-engine-step may legitimately use its full
 * 800-second function budget, so this sits above that but below the 15-minute
 * maxRuntime that cron-monitor.ts reports to Sentry, keeping a timeout here from
 * failing a check-in that would otherwise have succeeded.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.HEXCLAVE_RAILWAY_CRON_TIMEOUT_MS || 840_000);

const MINUTE_MS = 60_000;

if (CRON_SECRET === "") {
  throw new Error(
    "railway/cron: CRON_SECRET is not set. The internal cron endpoints authorise on it, so every "
    + "firing would be rejected. Set CRON_SECRET, or set HEXCLAVE_RAILWAY_DISABLE_CRON=true to run "
    + "without a scheduler.",
  );
}

/** Paths currently mid-flight, so a slow run is never overlapped by the next tick. */
const inFlight = new Set();

function fire(cron) {
  if (inFlight.has(cron.path)) {
    console.log(`railway/cron: ${cron.path} still running, skipping this tick`);
    return;
  }
  inFlight.add(cron.path);
  const startedAt = performance.now();
  const elapsedSeconds = () => ((performance.now() - startedAt) / 1000).toFixed(1);

  const request = http.request({
    host: UPSTREAM_HOST,
    port: BACKEND_PORT,
    path: cron.path,
    method: "GET",
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      // cron-monitor.ts only opens a Sentry check-in when the request looks like
      // a genuine Vercel cron invocation (this exact user-agent plus a matching
      // bearer token). Sending it means self-hosted crons produce the same
      // monitoring signal as the hosted product instead of running unobserved.
      "user-agent": "vercel-cron/1.0",
    },
  }, (response) => {
    response.resume();
    response.on("end", () => {
      inFlight.delete(cron.path);
      const status = response.statusCode ?? 0;
      const line = `railway/cron: ${cron.path} -> ${status} in ${elapsedSeconds()}s`;
      if (status >= 200 && status < 400) console.log(line);
      else console.error(line);
    });
  });

  request.on("timeout", () => {
    request.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`));
  });
  request.on("error", (error) => {
    inFlight.delete(cron.path);
    console.error(`railway/cron: ${cron.path} FAILED after ${elapsedSeconds()}s: ${error.message}`);
  });
  request.end();
}

const crons = loadCrons(SCHEDULE_PATH);
console.log(`railway/cron: loaded ${crons.length} schedule(s) from ${SCHEDULE_PATH}:`);
for (const cron of crons) {
  console.log(`railway/cron:   ${cron.expression}  ${cron.path}`);
}

/**
 * Re-arms against the wall clock each tick rather than using setInterval, so
 * accumulated timer drift can never walk the runner off the minute boundary and
 * skip a scheduled minute entirely.
 */
function scheduleNextTick() {
  const delay = MINUTE_MS - (Date.now() % MINUTE_MS);
  setTimeout(() => {
    const tickDate = new Date();
    for (const cron of crons) {
      if (matches(cron.schedule, tickDate)) fire(cron);
    }
    scheduleNextTick();
  }, delay);
}

scheduleNextTick();

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
