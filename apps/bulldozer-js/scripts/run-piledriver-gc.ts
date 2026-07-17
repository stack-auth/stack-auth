// Load .env files before anything reads process.env (mirrors src/index.ts). This script is its own
// entrypoint and does not go through index.ts, so import load-env explicitly and first.
import "../src/load-env.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { declareLmdbLowLevelDatabase } from "../src/databases/low-level/implementations/lmdb.js";
import type { LowLevelDatabase } from "../src/databases/low-level/index.js";
import { collectPiledriverGarbage } from "../src/databases/piledriver/gc.js";

/**
 * Standalone, schedulable Piledriver garbage collector. Run it on a schedule (like the backfill),
 * pointed at the same LMDB directory the Bulldozer server uses. LMDB allows one writer plus many
 * readers across processes, so this can run while the server is live.
 *
 * Requires the server to be configured with `enableRootHistory: true` (env
 * HEXCLAVE_BULLDOZER_JS_ENABLE_ROOT_HISTORY=1) so the root-history the GC relies on exists.
 *
 * Env:
 *  - HEXCLAVE_BULLDOZER_JS_LMDB_PATH: LMDB directory (defaults to <cwd>/.data/bulldozer-js-lmdb).
 *  - HEXCLAVE_BULLDOZER_JS_GC_ROOT_HISTORY_RETENTION_MS: retention window; MUST exceed the server's
 *    HEXCLAVE_BULLDOZER_JS_HEAP_REFERENCE_MAX_AGE_MS (M). Defaults to 1 hour.
 *  - HEXCLAVE_BULLDOZER_JS_GC_DELETE_BATCH_SIZE: keys deleted per write (defaults to 1000).
 *  - HEXCLAVE_BULLDOZER_JS_GC_DRY_RUN=1: report what would be collected without deleting.
 */

function requiredPositiveNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive finite number, got ${JSON.stringify(value)}`);
  return parsed;
}

function lmdbPath(): string {
  const configured = process.env.HEXCLAVE_BULLDOZER_JS_LMDB_PATH;
  if (configured !== undefined && configured.length > 0) return configured;
  return join(process.cwd(), ".data", "bulldozer-js-lmdb");
}

const path = lmdbPath();
mkdirSync(path, { recursive: true });

// The GC opens the raw LMDB backend directly: it does not need the instant-availability read cache
// the server layers on top, and going straight to LMDB keeps the delete path simple.
const lowLevelDb: LowLevelDatabase = declareLmdbLowLevelDatabase({ path });

const rootHistoryRetentionMs = requiredPositiveNumberEnv("HEXCLAVE_BULLDOZER_JS_GC_ROOT_HISTORY_RETENTION_MS", 60 * 60 * 1000);
const deleteBatchSize = requiredPositiveNumberEnv("HEXCLAVE_BULLDOZER_JS_GC_DELETE_BATCH_SIZE", 1_000);
const dryRun = process.env.HEXCLAVE_BULLDOZER_JS_GC_DRY_RUN === "1";

const startedAt = performance.now();
const result = await collectPiledriverGarbage(lowLevelDb, { rootHistoryRetentionMs, deleteBatchSize, dryRun });
console.log(JSON.stringify({
  component: "bulldozer-js",
  event: "piledriver-gc-finished",
  path,
  rootHistoryRetentionMs,
  elapsedMs: performance.now() - startedAt,
  ...result,
}));
