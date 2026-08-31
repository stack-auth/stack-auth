// The no-listen entry: the hosting platform owns the listener and hands each request to the
// exported app. Built by tsdown into dist/vercel.mjs, which src/index.ts (Vercel's detected
// entrypoint) re-exports.
//
// Deliberately does NOT import ./load-env: on a hosted deployment the platform's environment
// is the only source of configuration, and the committed .env / .env.development files are
// dev/mock defaults that must never be a fallback for a production process. Configuration is
// read at import time (createMarshalApp calls getConfig), so a missing or unsafe variable
// fails the function's cold start with marshal's own message instead of failing per request.
import { createMarshalApp } from "./marshal-app.js";
import { schedulePoolReplenishment } from "./project-pool.js";

const { app } = createMarshalApp();
// Fire-and-forget pool top-up on cold start (no-op when the pool is disabled). It must not
// delay or fail the invocation, which is what schedulePoolReplenishment guarantees.
schedulePoolReplenishment();

export default app;
