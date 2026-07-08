/**
 * Cross-version serialization compatibility harness, used by the `serialization-compat` GitHub
 * Actions workflow. Unlike the golden fixtures (which pin a frozen shape), this proves that two
 * *different code versions* interoperate on the wire:
 *
 *   emit  <file>   build the deterministic sample tree, persist it, and write a self-describing dump
 *   verify <file>  read a dump written by (possibly) another code version and assert it reproduces
 *                  the exact query results its writer observed
 *
 * The workflow runs `emit` under one checkout and `verify` under the other, in both directions:
 *   - new code reads a dump written by base code  (backward compat: prod upgrade)
 *   - base code reads a dump written by new code   (forward compat: prod rollback)
 *
 * This file (and serialization-fixture-utils.ts) is copied into the base-branch checkout by the
 * workflow, so it must only rely on the long-stable AugmentedTreeMap / piledriver public API.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  FIXTURE_ARITY,
  FIXTURE_ROW_COUNT,
  SerializationDump,
  buildSampleTree,
  computeQueries,
  resolveHeap,
  treeFromDump,
} from "./serialization-fixture-utils.js";

async function emit(path: string) {
  const tree = await buildSampleTree(FIXTURE_ARITY, FIXTURE_ROW_COUNT);
  const dump: SerializationDump = {
    arity: FIXTURE_ARITY,
    tree: await resolveHeap(tree.toPiledriverObject()),
    queries: await computeQueries(tree),
  };
  writeFileSync(path, `${JSON.stringify(dump, null, 2)}\n`);
  process.stdout.write(`emitted serialization dump to ${path}\n`);
}

async function verify(path: string) {
  // Boundary parse of a dump written by this or another code version; mismatches surface below.
  const dump = JSON.parse(readFileSync(path, "utf8")) as SerializationDump;
  const actual = await computeQueries(treeFromDump(dump));
  const expected = JSON.stringify(dump.queries);
  if (JSON.stringify(actual) !== expected) {
    process.stderr.write(`serialization cross-version MISMATCH reading ${path}\n  expected: ${expected}\n  actual:   ${JSON.stringify(actual)}\n`);
    process.exit(1);
  }
  process.stdout.write(`verified serialization dump ${path} (queries reproduced exactly)\n`);
}

async function main() {
  const [mode, path] = process.argv.slice(2);
  if ((mode !== "emit" && mode !== "verify") || !path) {
    process.stderr.write("usage: serialization-cross-version.ts <emit|verify> <file>\n");
    process.exit(2);
    return;
  }
  if (mode === "emit") await emit(path);
  else await verify(path);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
