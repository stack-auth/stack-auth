/**
 * Regenerates the golden serialization fixtures used by `serialization-compat.test.ts`.
 *
 * These fixtures freeze the on-disk shape of a persisted `AugmentedTreeMap` for each node format
 * version, so that if a future change alters how nodes are (de)serialized in a way that breaks
 * reading previously-persisted data, the compat test fails immediately.
 *
 * IMPORTANT: never edit or delete an existing fixture by hand — that would defeat the purpose.
 * When you introduce a new node format version, bump `nodeFormatVersion` in augmented-tree-map.ts,
 * add a new `writeFixture(...)` call below, and run:
 *
 *   pnpm -C apps/bulldozer-js exec tsx src/databases/piledriver/data-structures/__fixtures__/generate-serialization-fixtures.ts
 *
 * The v0 fixture (no `version`/`entryAugmentations` fields) reproduces the exact node shape that
 * builds before format versioning wrote, so we keep proving that legacy production data still reads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_ARITY,
  FIXTURE_ROW_COUNT,
  Json,
  SerializationDump,
  buildSampleTree,
  computeQueries,
  resolveHeap,
} from "./serialization-fixture-utils.js";

const here = dirname(fileURLToPath(import.meta.url));

// Produces the pre-versioning node shape by dropping the fields v0 nodes never had, everywhere they
// appear in the graph.
function stripToV0(value: Json): Json {
  if (Array.isArray(value)) return value.map(stripToV0);
  if (value === null || typeof value !== "object") return value;
  const out: { [key: string]: Json } = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "version" || key === "entryAugmentations") continue;
    out[key] = stripToV0(child);
  }
  return out;
}

function writeFixture(name: string, body: SerializationDump) {
  const path = join(here, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
  process.stdout.write(`wrote ${path}\n`);
}

async function main() {
  mkdirSync(here, { recursive: true });
  const tree = await buildSampleTree(FIXTURE_ARITY, FIXTURE_ROW_COUNT);
  const treeObject = await resolveHeap(tree.toPiledriverObject());
  const queries = await computeQueries(tree);

  writeFixture("v1", { arity: FIXTURE_ARITY, tree: treeObject, queries });
  writeFixture("v0", { arity: FIXTURE_ARITY, tree: stripToV0(treeObject), queries });
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
