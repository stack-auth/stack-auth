import { decodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { LowLevelDatabase, LowLevelDatabaseDebugEntry, LowLevelKvDump, LowLevelKvStore } from "../low-level/index.js";
import { decodeRootHistoryKeyTimestamp, PILEDRIVER_HEAP_DUMP_ID, PILEDRIVER_HEAP_REFERENCE_MARKER, PILEDRIVER_ROOT_HISTORY_STORE_ID, PILEDRIVER_ROOT_STORE_ID } from "./index.js";

/**
 * Standalone Piledriver garbage collector.
 *
 * This module deliberately shares only the low-level KV format and the heap-reference marker
 * convention with the rest of Piledriver — it never imports the high-level database implementation,
 * so it can run in a separate, schedulable process (see `scripts/run-piledriver-gc.ts`).
 *
 * How it stays correct with almost no bookkeeping (root-history model):
 *  - The database persists every committed root, with a wall-clock timestamp, into an append-only
 *    `root-history` store (enabled via `PiledriverDatabaseOptions.enableRootHistory`).
 *  - The GC keeps every heap object transitively reachable from ANY root committed within its
 *    retention window (plus whatever is currently in `root`), and deletes everything else.
 *  - The one invariant callers must uphold: `rootHistoryRetentionMs` MUST exceed the database's
 *    `heapReferenceMaxAgeMs` (M). A reader/writer can only still touch a heap object through an
 *    in-memory handle that is younger than M, and such a handle descends from a root that was read
 *    within M — hence committed (and therefore in history) within M < retention — hence that object
 *    is still reachable from a retained root and will not be collected. Past M the handle's `.get()`
 *    (and key reuse) throws, so no live handle can reach a collected object.
 *
 * Concurrency: everything to be deleted is chosen from a single enumeration of the heap taken at the
 * start of the pass. Objects inserted concurrently (new random-ish keys) are simply not in that
 * enumeration, so a running pass never deletes them; new roots committed during the pass are the
 * freshest and always inside the retention window. Deletes are issued in bounded batches to keep the
 * single-writer lock held only briefly at a time.
 */

const textDecoder = new TextDecoder();

export type PiledriverGarbageCollectionOptions = {
  /**
   * Only roots committed within this many milliseconds of `now` are retained (in addition to the
   * current root(s) in the `root` store). MUST be strictly larger than the database's
   * `heapReferenceMaxAgeMs` (M); see the module doc for why.
   */
  rootHistoryRetentionMs: number,
  /** Wall-clock reference time in ms; defaults to `Date.now()`. Matches the units of root-history keys. */
  now?: number,
  /** When true, compute what would be collected/pruned but perform no deletions. */
  dryRun?: boolean,
  /** Maximum number of keys deleted per low-level write, bounding how long the writer lock is held. */
  deleteBatchSize?: number,
};

export type PiledriverGarbageCollectionResult = {
  retainedRootCount: number,
  retainedRootHistoryCount: number,
  totalHeapObjectCount: number,
  liveHeapObjectCount: number,
  deletedHeapObjectCount: number,
  prunedRootHistoryCount: number,
  dryRun: boolean,
};

// Walks a parsed serialized Piledriver payload and collects the base64 keys of every heap reference
// (`["heap-reference", key]`) it contains, at any nesting depth. The serialized encoding only ever
// emits arrays for its own wrappers (`["array", ...]`, `["heap-reference", ...]`, `["NaN"]`, ...),
// so any array whose head is the heap-reference marker is unambiguously a heap reference.
function collectHeapReferenceKeysFromJsonable(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    if (node[0] === PILEDRIVER_HEAP_REFERENCE_MARKER && typeof node[1] === "string") {
      out.add(node[1]);
      return;
    }
    for (const item of node) collectHeapReferenceKeysFromJsonable(item, out);
  } else if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) collectHeapReferenceKeysFromJsonable(value, out);
  }
}

function heapReferenceKeysInSerializedValue(valueBase64: string): string[] {
  const bytes = decodeBase64(valueBase64);
  const jsonable: unknown = JSON.parse(textDecoder.decode(bytes));
  const out = new Set<string>();
  collectHeapReferenceKeysFromJsonable(jsonable, out);
  return [...out];
}

async function requireDebugEntries(storeOrDump: LowLevelKvStore | LowLevelKvDump, label: string): Promise<LowLevelDatabaseDebugEntry[]> {
  if (storeOrDump.debugEntries === undefined) {
    throw new Error(`Piledriver GC requires debugEntries() to enumerate the "${label}" store/dump, but the low-level backend does not implement it`);
  }
  return await storeOrDump.debugEntries();
}

export async function collectPiledriverGarbage(lowLevelDb: LowLevelDatabase, options: PiledriverGarbageCollectionOptions): Promise<PiledriverGarbageCollectionResult> {
  const now = options.now ?? Date.now();
  const retentionMs = options.rootHistoryRetentionMs;
  if (!(Number.isFinite(retentionMs) && retentionMs >= 0)) throw new Error(`rootHistoryRetentionMs must be a non-negative finite number, got ${retentionMs}`);
  const dryRun = options.dryRun === true;
  const deleteBatchSize = options.deleteBatchSize ?? 1_000;
  if (!(Number.isInteger(deleteBatchSize) && deleteBatchSize > 0)) throw new Error(`deleteBatchSize must be a positive integer, got ${deleteBatchSize}`);

  const rootStore = lowLevelDb.declareKvStore(PILEDRIVER_ROOT_STORE_ID);
  const heapDump = lowLevelDb.declareKvDump(PILEDRIVER_HEAP_DUMP_ID);
  const rootHistoryStore = lowLevelDb.declareKvStore(PILEDRIVER_ROOT_HISTORY_STORE_ID);

  // Enumerate everything up front. Deletions are chosen only from this snapshot of the heap, which is
  // what makes the pass safe against concurrent writers (see module doc).
  const rootEntries = await requireDebugEntries(rootStore, "root");
  const historyEntries = await requireDebugEntries(rootHistoryStore, "root-history");
  const heapEntries = await requireDebugEntries(heapDump, "heap");

  const retainedRootValueBase64: string[] = rootEntries.map(entry => entry.valueBase64);
  const prunableHistoryKeys: ArrayBuffer[] = [];
  let retainedRootHistoryCount = 0;
  for (const entry of historyEntries) {
    if (entry.keyUtf8 === null) throw new Error(`Piledriver GC encountered a root-history entry with a non-UTF-8 key (keyBase64=${entry.keyBase64})`);
    const committedAt = decodeRootHistoryKeyTimestamp(entry.keyUtf8);
    if (now - committedAt <= retentionMs) {
      retainedRootValueBase64.push(entry.valueBase64);
      retainedRootHistoryCount++;
    } else {
      prunableHistoryKeys.push(decodeBase64(entry.keyBase64).buffer);
    }
  }

  // Transitive reachability from all retained roots. Consecutive roots share almost their entire
  // closure (copy-on-write churn), so the `live` set means each object is scanned at most once.
  const heapValueByKeyBase64 = new Map(heapEntries.map(entry => [entry.keyBase64, entry.valueBase64]));
  const live = new Set<string>();
  const queue: string[] = [];
  const enqueue = (keyBase64: string) => {
    if (!live.has(keyBase64)) {
      live.add(keyBase64);
      queue.push(keyBase64);
    }
  };
  for (const valueBase64 of retainedRootValueBase64) {
    for (const ref of heapReferenceKeysInSerializedValue(valueBase64)) enqueue(ref);
  }
  while (queue.length > 0) {
    const keyBase64 = queue.pop();
    if (keyBase64 === undefined) break;
    const valueBase64 = heapValueByKeyBase64.get(keyBase64);
    // Missing means it was inserted after our enumeration (so not our concern this pass) or already
    // absent; either way there is nothing to traverse or delete.
    if (valueBase64 === undefined) continue;
    for (const ref of heapReferenceKeysInSerializedValue(valueBase64)) enqueue(ref);
  }

  const liveHeapObjectCount = heapEntries.reduce((count, entry) => count + (live.has(entry.keyBase64) ? 1 : 0), 0);
  const heapKeysToDelete = heapEntries.filter(entry => !live.has(entry.keyBase64)).map(entry => decodeBase64(entry.keyBase64).buffer);

  if (!dryRun) {
    for (let i = 0; i < heapKeysToDelete.length; i += deleteBatchSize) {
      const { seq } = await heapDump.deleteAll(heapKeysToDelete.slice(i, i + deleteBatchSize));
      await lowLevelDb.waitUntilAvailable(seq);
    }
    for (let i = 0; i < prunableHistoryKeys.length; i += deleteBatchSize) {
      const { seq } = await rootHistoryStore.deleteAll(prunableHistoryKeys.slice(i, i + deleteBatchSize));
      await lowLevelDb.waitUntilAvailable(seq);
    }
  }

  return {
    retainedRootCount: rootEntries.length,
    retainedRootHistoryCount,
    totalHeapObjectCount: heapEntries.length,
    liveHeapObjectCount,
    deletedHeapObjectCount: heapKeysToDelete.length,
    prunedRootHistoryCount: prunableHistoryKeys.length,
    dryRun,
  };
}
