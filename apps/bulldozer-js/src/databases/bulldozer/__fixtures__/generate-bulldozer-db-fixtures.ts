/**
 * Regenerates the golden whole-database serialization fixtures used by `bulldozer-db-compat.test.ts`.
 *
 * Each fixture freezes an entire persisted Bulldozer database (the example ledger schema, exercising
 * every table operator) as it is written to disk for a given node format version, so that if a future
 * change alters how the database is (de)serialized in a way that breaks reading previously-persisted
 * production data, the compat test fails immediately.
 *
 * The `v1` fixture is produced from a real LMDB-backed run (its values are exactly the bytes an LMDB
 * `data.mdb` stores). The `v0` fixture reproduces the pre-versioning node shape by dropping the
 * `version`/`entryAugmentations` fields that older builds never wrote — proving legacy production
 * databases still read back consistently.
 *
 * IMPORTANT: never edit or delete an existing fixture by hand. When you introduce a new node format
 * version, bump `nodeFormatVersion` in augmented-tree-map.ts, add a new `writeFixture(...)` below, and
 * run:
 *
 *   pnpm -C apps/bulldozer-js exec tsx src/databases/bulldozer/__fixtures__/generate-bulldozer-db-fixtures.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { declareLmdbLowLevelDatabase } from "../../low-level/implementations/lmdb.js";
import { BulldozerDbDump, KvEntry, buildFixtureBulldozerDatabase, dumpBulldozerDatabase } from "./bulldozer-db-fixture-utils.js";

const here = dirname(fileURLToPath(import.meta.url));
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type WireJson = null | boolean | number | string | WireJson[] | { [key: string]: WireJson };

// Drops the fields that pre-versioning AugmentedTreeMap nodes never wrote from the piledriver wire
// JSON (a "normal" object is serialized as a plain JSON object keyed by its own field names). Only the
// per-node `version`/`entryAugmentations` fields are removed — a B-tree node is the object carrying
// both `entries` and `children`. The unrelated table wrapper's own `version` field (`{ version, map }`,
// which predates node versioning and is required by the deserializer) is intentionally left intact.
function stripWireToV0(value: WireJson): WireJson {
  if (Array.isArray(value)) return value.map(stripWireToV0);
  if (value === null || typeof value !== "object") return value;
  const isTreeNode = "entries" in value && "children" in value;
  const out: { [key: string]: WireJson } = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "entryAugmentations") continue;
    if (key === "version" && isTreeNode) continue;
    out[key] = stripWireToV0(child);
  }
  return out;
}

function stripEntryToV0(entry: KvEntry): KvEntry {
  const wire = JSON.parse(textDecoder.decode(decodeBase64(entry.valueBase64))) as WireJson;
  const strippedJson = JSON.stringify(stripWireToV0(wire));
  return { keyBase64: entry.keyBase64, valueBase64: encodeBase64(new Uint8Array(textEncoder.encode(strippedJson))) };
}

function stripDumpToV0(dump: BulldozerDbDump): BulldozerDbDump {
  const strip = (byId: Record<string, KvEntry[]>) =>
    Object.fromEntries(Object.entries(byId).map(([id, entries]) => [id, entries.map(stripEntryToV0)]));
  // The logical state (readModel) is unchanged: v0 nodes recompute the augmentations the v1 cache held.
  return { stores: strip(dump.stores), dumps: strip(dump.dumps), readModel: dump.readModel };
}

function writeFixture(name: string, body: BulldozerDbDump) {
  const path = join(here, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(`wrote ${path}\n`);
}

async function main() {
  const lmdbPath = mkdtempSync(join(tmpdir(), "bulldozer-db-fixture-"));
  try {
    const lowLevel = declareLmdbLowLevelDatabase({ path: lmdbPath, dbId: "bulldozer" });
    const db = await buildFixtureBulldozerDatabase(lowLevel);
    const v1 = await dumpBulldozerDatabase(lowLevel, db);
    writeFixture("db-v1", v1);
    writeFixture("db-v0", stripDumpToV0(v1));
  } finally {
    rmSync(lmdbPath, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
