// Standalone Node entrypoint: owns the listener. Everything hosted (Vercel) goes through
// src/vercel.ts instead, which exports the same app without binding a port. This file is
// what `pnpm start` / `pnpm dev` / the e2e workflows run.
import "./load-env.js";
import { createMarshalApp } from "./marshal-app.js";
import { getConfig } from "./config.js";
import { schedulePoolReplenishment } from "./project-pool.js";

const config = getConfig();
const { app } = createMarshalApp();
app.listen(config.port);
// Fire-and-forget: keeps a few fully provisioned tenant projects ready so a first deploy
// into a new namespace does not wait out project creation, billing propagation and API
// enablement. No-op when HEXCLAVE_MARSHAL_GCP_PROJECT_POOL_SIZE is 0.
schedulePoolReplenishment();

console.log(`Marshal listening on http://localhost:${config.port} (env=${config.envId}, builder=${config.builderKind}, gcp region=${config.gcp.region})`);
