// Load .env files before anything reads process.env (mirrors src/index.ts). load-env.ts
// claims to cover "the studio/profiling scripts", but that only holds if each entrypoint
// imports it — this script doesn't go through index.ts, so import it explicitly and first.
import "../src/load-env.js";
import { runBulldozerStudio } from "../src/databases/bulldozer/studio.js";

const port = process.env.BULLDOZER_STUDIO_PORT === undefined ? undefined : Number(process.env.BULLDOZER_STUDIO_PORT);

await runBulldozerStudio({ port });

