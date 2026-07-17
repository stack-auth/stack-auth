import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { shouldSuppressPeriodicBulldozerLogs } from "../../logging.js";
import { traceSpan, traceSpanHot } from "../../otel.js";
import { Database, DatabaseSeq } from "../index.js";
import { LowLevelDatabase, LowLevelDatabaseDebugSnapshot } from "../low-level/index.js";

export const isPiledriverHeapObjectSymbol = Symbol.for("hexclave-piledriver-heap-object-symbol");
export type PiledriverHeapObject = {
  get(): Promise<PiledriverObject>,
  [isPiledriverHeapObjectSymbol]: true,
};

// Per-in-memory-heap-reference bookkeeping shared (as a mutable box) between the read-cache entry
// and the handle it describes. `referencedAt` is a `performance.now()` timestamp of the most recent
// moment we *knew* this heap object was reachable from a live root: it is stamped when the handle is
// created while reading a fresh root and refreshed whenever the same key is re-read from, or
// re-committed into, a root. Once it is older than the configured `heapReferenceMaxAgeMs` (M), the
// handle's `.get()` refuses to read (the object may already have been collected) and the read cache
// evicts the entry. See the garbage collector (`gc.ts`) for the matching root-retention window.
type HeapReferenceState = { referencedAt: number };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Low-level store/dump ids used by a Piledriver database. Exported so the standalone GC can open the
// exact same stores/dump without importing the high-level database implementation.
export const PILEDRIVER_ROOT_STORE_ID = "root";
export const PILEDRIVER_HEAP_DUMP_ID = "heap";
export const PILEDRIVER_ROOT_HISTORY_STORE_ID = "root-history";
// The marker used as the first element of a serialized heap reference array: `["heap-reference", key]`.
export const PILEDRIVER_HEAP_REFERENCE_MARKER = "heap-reference";

// Root-history keys embed a WALL-CLOCK timestamp (Date.now(), not performance.now()) because the GC
// runs in a *separate process* and must compare these timestamps against its own wall clock;
// performance.now() is only monotonic within a single process. The zero-padded prefix keeps keys
// lexicographically time-ordered; the random hex suffix disambiguates commits within the same
// millisecond. Total length stays well under the 64-byte key limit.
const ROOT_HISTORY_TIMESTAMP_DIGITS = 16;
export function encodeRootHistoryKey(wallClockMs: number): ArrayBuffer {
  const suffix = [...crypto.getRandomValues(new Uint8Array(8))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return textEncoder.encode(`${Math.floor(wallClockMs).toString().padStart(ROOT_HISTORY_TIMESTAMP_DIGITS, "0")}-${suffix}`).buffer;
}
export function decodeRootHistoryKeyTimestamp(keyUtf8: string): number {
  const millis = Number.parseInt(keyUtf8.slice(0, keyUtf8.indexOf("-")), 10);
  if (!Number.isFinite(millis)) throw new Error(`Malformed Piledriver root-history key (expected "<paddedMillis>-<hex>"): ${keyUtf8}`);
  return millis;
}

const heapObjectsMapNullSentinel = { __heapObjectsMapNullSentinel: true };
const heapObjectsByObject = new WeakMap<PiledriverObject & object, PiledriverHeapObject>();
/**
 * Creates a new heap object, which will be stored as a reference by Piledriver.
 *
 * Accessing it will take an extra database lookup, but becomes an optional operation.
 *
 * Note that since Piledriver objects are inherently immutable, `obj` must be immutable as well. Behavior is undefined
 * if it is modified after being passed to this function.
 */
export function asHeapObject(obj: PiledriverObject): PiledriverHeapObject {
  if (typeof obj !== "object") throw new Error("Can only create heap objects from actual objects!");
  const existing = heapObjectsByObject.get(obj ?? heapObjectsMapNullSentinel);
  if (existing) return existing;

  const res: PiledriverHeapObject = {
    async get() {
      return obj;
    },
    [isPiledriverHeapObjectSymbol]: true,
  };
  heapObjectsByObject.set(obj ?? heapObjectsMapNullSentinel, res);
  return res;
}

export type PiledriverObject = string | number | boolean | null | PiledriverObject[] | { [key: string]: PiledriverObject } | PiledriverHeapObject;
export function piledriverObjectEquals(a: PiledriverObject, b: PiledriverObject): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    if (a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => piledriverObjectEquals(v, b[i]));
    }
    const aEntries = Object.entries(a);
    const bRecord = b as { [key: string]: PiledriverObject };
    return aEntries.length === Object.keys(bRecord).length && aEntries.every(([k, v]) => piledriverObjectEquals(v, bRecord[k]));
  }
  return false;
}

export type PiledriverDatabase = Database & {
  getRootObject(key: ArrayBuffer): Promise<{ object: PiledriverObject, seq: DatabaseSeq }>,
  setRootObject(key: ArrayBuffer, value: PiledriverObject): Promise<{ seq: DatabaseSeq }>,
  deleteRootObject(key: ArrayBuffer): Promise<{ seq: DatabaseSeq }>,
  debugSnapshot?(): Promise<PiledriverDatabaseDebugSnapshot>,
  debugLowLevelSnapshot?(): Promise<LowLevelDatabaseDebugSnapshot>,
};

export type PiledriverDatabaseDebugSnapshot = {
  roots: Array<{ keyBase64: string, keyUtf8: string | null, keyHex: string, serializedJson: unknown, valueByteLength: number }>,
  heap: Array<{ keyBase64: string, keyUtf8: string | null, keyHex: string, serializedJson: unknown, valueByteLength: number }>,
};
export type PiledriverDatabaseOptions = {
  disableHeapReadCache?: boolean,
  /**
   * M: the maximum age (in ms, measured with `performance.now()`) of an in-memory heap reference,
   * counted from the last moment we knew it was referenced from a live root. Past this age, a
   * handle's `.get()` throws (its object may have been garbage-collected under the matching GC
   * retention window) and the read cache evicts the entry. Defaults to `Infinity` (never expire,
   * i.e. the previous behavior). Callers that also run the GC MUST set this below the GC's root
   * retention window so that any object reachable from a still-usable handle is still retained.
   */
  heapReferenceMaxAgeMs?: number,
  /** How often to sweep expired entries out of the read cache. Defaults to a fraction of M. */
  heapReferenceCacheSweepIntervalMs?: number,
  /**
   * When true, every committed root is also appended (with a wall-clock timestamp) to an
   * append-only `root-history` store. The standalone GC keeps every heap object reachable from any
   * root committed within its retention window; without this history it could only see the current
   * root and would collect objects that in-flight readers/writers can still reach. Defaults to
   * false so callers that don't run the GC don't pay for the extra writes.
   */
  enableRootHistory?: boolean,
};

// Tracks the chain of *heap objects* currently being serialized, so heap cycles fail fast with
// a clear error instead of deadlocking on their own memoized promise. Sibling/DAG sharing is
// fine: only true ancestors are in the path. Plain-object cycles are detected separately with a
// push/pop set during the synchronous payload walk.
type HeapSerializationPath = ReadonlySet<PiledriverHeapObject>;
type PiledriverSerializationTimingStats = {
  primitiveNodes: number,
  arrayNodes: number,
  arrayItems: number,
  objectNodes: number,
  objectEntries: number,
  heapReferenceNodes: number,
  serializeToJsonableTotalMs: number,
  jsonStringifyTotalMs: number,
  textEncodeTotalMs: number,
  heapObjectCacheHits: number,
  heapObjectCacheMisses: number,
  heapObjectCacheHitAwaitTotalMs: number,
  heapObjectCacheMissAwaitTotalMs: number,
  heapObjectGetTotalMs: number,
  heapObjectSerializeTotalMs: number,
  heapObjectInsertAwaitTotalMs: number,
  branchStats: Map<string, PiledriverSerializationBranchStats>,
  heapObjectCacheMissesByShape: Map<string, number>,
  heapObjectCacheMissInlineNodeCountsByShape: Map<string, number>,
};
type PiledriverSerializationBranchStats = {
  primitiveNodes: number,
  arrayNodes: number,
  objectNodes: number,
  objectEntries: number,
  heapReferenceNodes: number,
  heapObjectCacheHits: number,
  heapObjectCacheMisses: number,
  heapObjectCacheMissesByShape: Map<string, number>,
  heapObjectCacheMissInlineNodeCountsByShape: Map<string, number>,
};
type PiledriverInlineNodeCounts = {
  primitiveNodes: number,
  arrayNodes: number,
  objectNodes: number,
  heapReferenceNodes: number,
};

function emptyPiledriverSerializationBranchStats(): PiledriverSerializationBranchStats {
  return {
    primitiveNodes: 0,
    arrayNodes: 0,
    objectNodes: 0,
    objectEntries: 0,
    heapReferenceNodes: 0,
    heapObjectCacheHits: 0,
    heapObjectCacheMisses: 0,
    heapObjectCacheMissesByShape: new Map(),
    heapObjectCacheMissInlineNodeCountsByShape: new Map(),
  };
}

function emptyPiledriverSerializationTimingStats(): PiledriverSerializationTimingStats {
  return {
    primitiveNodes: 0,
    arrayNodes: 0,
    arrayItems: 0,
    objectNodes: 0,
    objectEntries: 0,
    heapReferenceNodes: 0,
    serializeToJsonableTotalMs: 0,
    jsonStringifyTotalMs: 0,
    textEncodeTotalMs: 0,
    heapObjectCacheHits: 0,
    heapObjectCacheMisses: 0,
    heapObjectCacheHitAwaitTotalMs: 0,
    heapObjectCacheMissAwaitTotalMs: 0,
    heapObjectGetTotalMs: 0,
    heapObjectSerializeTotalMs: 0,
    heapObjectInsertAwaitTotalMs: 0,
    branchStats: new Map(),
    heapObjectCacheMissesByShape: new Map(),
    heapObjectCacheMissInlineNodeCountsByShape: new Map(),
  };
}

function incrementMapCount(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function addMapCount(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function emptyPiledriverInlineNodeCounts(): PiledriverInlineNodeCounts {
  return {
    primitiveNodes: 0,
    arrayNodes: 0,
    objectNodes: 0,
    heapReferenceNodes: 0,
  };
}

function addPiledriverInlineNodeCounts(target: PiledriverInlineNodeCounts, source: PiledriverInlineNodeCounts) {
  target.primitiveNodes += source.primitiveNodes;
  target.arrayNodes += source.arrayNodes;
  target.objectNodes += source.objectNodes;
  target.heapReferenceNodes += source.heapReferenceNodes;
}

function totalInlineNodes(counts: PiledriverInlineNodeCounts) {
  return counts.primitiveNodes + counts.arrayNodes + counts.objectNodes + counts.heapReferenceNodes;
}

function countPiledriverInlineNodes(obj: PiledriverObject, path: Set<object> = new Set()): PiledriverInlineNodeCounts {
  switch (typeof obj) {
    case "number":
    case "string":
    case "boolean": {
      return { ...emptyPiledriverInlineNodeCounts(), primitiveNodes: 1 };
    }
    case "object": {
      if (obj === null) return { ...emptyPiledriverInlineNodeCounts(), primitiveNodes: 1 };
      if (isPiledriverHeapObjectSymbol in obj) return { ...emptyPiledriverInlineNodeCounts(), heapReferenceNodes: 1 };
      if (path.has(obj)) throw new Error("Piledriver objects must not contain cycles");
      const childPath = new Set(path).add(obj);
      const counts = emptyPiledriverInlineNodeCounts();
      if (Array.isArray(obj)) {
        counts.arrayNodes++;
        for (const item of obj) addPiledriverInlineNodeCounts(counts, countPiledriverInlineNodes(item, childPath));
      } else {
        counts.objectNodes++;
        for (const value of Object.values(obj)) addPiledriverInlineNodeCounts(counts, countPiledriverInlineNodes(value, childPath));
      }
      return counts;
    }
    default: {
      throw new Error("Assertion error: Unknown type of Piledriver object " + typeof obj);
    }
  }
}

function classifyHeapObjectPayload(obj: PiledriverObject): string {
  if (obj === null) return "null";
  if (Array.isArray(obj)) return `array:${obj.length}`;
  if (typeof obj !== "object") return typeof obj;
  const keys = Object.keys(obj).sort();
  if (keys.includes("entries") && keys.includes("children") && keys.includes("augmentation") && keys.includes("size") && keys.includes("minKey") && keys.includes("maxKey")) {
    const entries = Reflect.get(obj, "entries");
    const children = Reflect.get(obj, "children");
    return `btree-node:entries=${Array.isArray(entries) ? entries.length : "?"}:children=${Array.isArray(children) ? children.length : "?"}`;
  }
  if (keys.includes("key") && keys.includes("id") && keys.length === 2) return "multi-key";
  if (keys.includes("groupKey") && keys.includes("rows") && keys.length === 2) return "group-with-rows";
  if (keys.includes("inputRowData") && keys.includes("outputRowData") && keys.includes("stateAfter")) return "left-fold-row";
  if (keys.includes("state") && keys.includes("nextTriggerTimeMs") && keys.includes("emittedRows")) return "time-fold-row";
  if (keys.includes("outputRows") && keys.length === 1) return "time-fold-group";
  if (keys.includes("rowData") && keys.includes("rowIdentifier") && keys.includes("rowSortKey") && keys.includes("groupKey")) return "row-object";
  return `object:${keys.slice(0, 6).join(",")}${keys.length > 6 ? ",..." : ""}`;
}

function serializationBranchKey(path: readonly string[]): string {
  if (path[0] === "snapshot" && path[1] === "serializedTables") return `table:${path[2]}`;
  return path[0] ?? "<root>";
}

function serializationBranchStatsByKey(stats: PiledriverSerializationTimingStats | undefined, branchKey: string) {
  if (stats === undefined) return undefined;
  let result = stats.branchStats.get(branchKey);
  if (result === undefined) {
    result = emptyPiledriverSerializationBranchStats();
    stats.branchStats.set(branchKey, result);
  }
  return result;
}

export function declarePiledriverDatabase(lowLevelDb: LowLevelDatabase, options: PiledriverDatabaseOptions = {}): PiledriverDatabase {
  // TODO actually support cycles both for heap and non-heap objects (right now they are detected and rejected)

  const rootStore = lowLevelDb.declareKvStore(PILEDRIVER_ROOT_STORE_ID);
  const heapDump = lowLevelDb.declareKvDump(PILEDRIVER_HEAP_DUMP_ID);
  const rootHistoryStore = options.enableRootHistory === true ? lowLevelDb.declareKvStore(PILEDRIVER_ROOT_HISTORY_STORE_ID) : null;

  const heapReferenceMaxAgeMs = options.heapReferenceMaxAgeMs ?? Infinity;
  if (!(heapReferenceMaxAgeMs === Infinity || (Number.isFinite(heapReferenceMaxAgeMs) && heapReferenceMaxAgeMs > 0))) {
    throw new Error(`heapReferenceMaxAgeMs must be a positive number or Infinity, got ${heapReferenceMaxAgeMs}`);
  }

  const heapObjectsByHeapKeyBase64 = new Map<string, { refIdentity: string, object: WeakRef<PiledriverHeapObject>, seq: DatabaseSeq, state: HeapReferenceState }>();
  const heapObjectsByHeapKeyFinalizer = new FinalizationRegistry(([keyBase64, refIdentity]: [string, string]) => heapObjectsByHeapKeyBase64.get(keyBase64)?.refIdentity === refIdentity && heapObjectsByHeapKeyBase64.delete(keyBase64));
  const heapKeysAndSeqByHeapObjects = new WeakMap<PiledriverHeapObject, { promise: Promise<{ key: ArrayBuffer, seq: DatabaseSeq }>, state: HeapReferenceState }>();

  const cacheHeapObjectByKey = (key: ArrayBuffer, heapObj: PiledriverHeapObject, seq: DatabaseSeq, state: HeapReferenceState) => {
    const keyBase64 = encodeBase64(new Uint8Array(key));
    const refIdentity = crypto.randomUUID();
    heapObjectsByHeapKeyBase64.set(keyBase64, { refIdentity, object: new WeakRef(heapObj), seq, state });
    heapObjectsByHeapKeyFinalizer.register(heapObj, [keyBase64, refIdentity]);
  };

  // The read cache (heapObjectsByHeapKeyBase64) is a pure performance optimization now — correctness
  // is enforced by each handle's own M-check in .get() and by the GC's root-history retention — so we
  // can safely evict entries we haven't re-confirmed live within M. This also bounds the map's size.
  if (Number.isFinite(heapReferenceMaxAgeMs)) {
    const sweepIntervalMs = options.heapReferenceCacheSweepIntervalMs ?? Math.max(1_000, Math.min(heapReferenceMaxAgeMs, 60_000));
    const sweepTimer = setInterval(() => {
      const now = performance.now();
      for (const [keyBase64, entry] of heapObjectsByHeapKeyBase64) {
        if (now - entry.state.referencedAt > heapReferenceMaxAgeMs) heapObjectsByHeapKeyBase64.delete(keyBase64);
      }
    }, sweepIntervalMs);
    // Don't keep the process alive just for cache sweeping.
    sweepTimer.unref();
  }

  // Deduplicates and drops initial seqs before delegating to the low-level combineSeqs. This is
  // important for performance: each low-level combined seq allocates promises/map entries, so we
  // only want to create one when there are actually ≥2 distinct non-initial seqs to combine.
  // (Identity comparison against initialSeq is safe because initialSeq is a singleton object.)
  const combineSeqsDeduped = (seqs: Iterable<DatabaseSeq>): DatabaseSeq => {
    const unique = [...new Set(seqs)].filter(seq => seq !== lowLevelDb.initialSeq);
    if (unique.length === 0) return lowLevelDb.initialSeq;
    if (unique.length === 1) return unique[0];
    return lowLevelDb.combineSeqs(...unique);
  };

  const getHeapKeyAndSeq = async (heapObj: PiledriverHeapObject, heapPath: HeapSerializationPath, serializationTimingStats: PiledriverSerializationTimingStats | undefined, branchKey: string | undefined): Promise<{ key: ArrayBuffer, seq: DatabaseSeq }> => {
    // Must be checked before the memo lookup: awaiting the memoized promise of an ancestor
    // that is still being serialized would deadlock.
    if (heapPath.has(heapObj)) throw new Error("Piledriver objects must not contain cycles (found a cycle of heap objects)");

    const existing = heapKeysAndSeqByHeapObjects.get(heapObj);
    // Only reuse a cached key while the handle is still within M of when we last knew it was
    // referenced from a live root. Once it is older than M, the referenced object may already have
    // been garbage-collected (it was unreachable from every retained root for the whole grace
    // window), so reusing its key would create a dangling reference. Falling through to the miss
    // path re-inserts under a fresh key; for a lazily-loaded handle that path calls `.get()`, which
    // itself throws past M — i.e. you cannot resurrect an object through a stale reader handle.
    if (existing && performance.now() - existing.state.referencedAt <= heapReferenceMaxAgeMs) {
      // Reusing this heap object in the root we're committing now re-confirms it as referenced from
      // a (soon-to-be) live root, so refresh its liveness timestamp.
      existing.state.referencedAt = performance.now();
      if (serializationTimingStats !== undefined) {
        serializationTimingStats.heapObjectCacheHits++;
        const branch = branchKey === undefined ? undefined : serializationBranchStatsByKey(serializationTimingStats, branchKey);
        if (branch !== undefined) branch.heapObjectCacheHits++;
      }
      const cacheHitAwaitStartedAt = performance.now();
      try {
        return await existing.promise;
      } finally {
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectCacheHitAwaitTotalMs += performance.now() - cacheHitAwaitStartedAt;
      }
    }
    if (serializationTimingStats !== undefined) {
      serializationTimingStats.heapObjectCacheMisses++;
      const branch = branchKey === undefined ? undefined : serializationBranchStatsByKey(serializationTimingStats, branchKey);
      if (branch !== undefined) branch.heapObjectCacheMisses++;
    }

    const state: HeapReferenceState = { referencedAt: performance.now() };
    const promise = (async () => {
      const childHeapPath = new Set(heapPath).add(heapObj);
      return await traceSpanHot("bulldozer-js.piledriver.heap.serializeAndInsert", async () => {
        const heapObjectGetStartedAt = performance.now();
        const heapObject = await heapObj.get();
        if (serializationTimingStats !== undefined) {
          const shape = classifyHeapObjectPayload(heapObject);
          const inlineNodeCount = totalInlineNodes(countPiledriverInlineNodes(heapObject));
          incrementMapCount(serializationTimingStats.heapObjectCacheMissesByShape, shape);
          addMapCount(serializationTimingStats.heapObjectCacheMissInlineNodeCountsByShape, shape, inlineNodeCount);
          const branch = branchKey === undefined ? undefined : serializationBranchStatsByKey(serializationTimingStats, branchKey);
          if (branch !== undefined) {
            incrementMapCount(branch.heapObjectCacheMissesByShape, shape);
            addMapCount(branch.heapObjectCacheMissInlineNodeCountsByShape, shape, inlineNodeCount);
          }
          serializationTimingStats.heapObjectGetTotalMs += performance.now() - heapObjectGetStartedAt;
        }
        const heapObjectSerializeStartedAt = performance.now();
        const serialized = await serializePiledriverObject(heapObject, childHeapPath, serializationTimingStats, branchKey);
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectSerializeTotalMs += performance.now() - heapObjectSerializeStartedAt;
        const heapObjectInsertStartedAt = performance.now();
        const inserted = await heapDump.insertAll([serialized.buffer], { requiresSeq: serialized.seq });
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectInsertAwaitTotalMs += performance.now() - heapObjectInsertStartedAt;
        return { key: inserted.keys[0], seq: inserted.seq };
      });
    })();
    heapKeysAndSeqByHeapObjects.set(heapObj, { promise, state });
    let result;
    const cacheMissAwaitStartedAt = performance.now();
    try {
      result = await promise;
    } catch (error) {
      // Don't leave a poisoned rejected promise in the cache; a later retry may succeed.
      if (heapKeysAndSeqByHeapObjects.get(heapObj)?.promise === promise) heapKeysAndSeqByHeapObjects.delete(heapObj);
      throw error;
    } finally {
      if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectCacheMissAwaitTotalMs += performance.now() - cacheMissAwaitStartedAt;
    }
    cacheHeapObjectByKey(result.key, heapObj, result.seq, state);
    return result;
  };

  // `referencedAt` is the `performance.now()` timestamp at which the enclosing root/heap object was
  // known to be referenced from a live root. It is inherited from the parent (NOT re-stamped to
  // `now` for each child) so that a snapshot read from a root that is already close to expiring
  // cannot indefinitely refresh its descendants by lazily loading them later — otherwise a stale
  // reader could still walk into objects the GC has collected.
  const getHeapObjectByKey = (key: ArrayBuffer, seq: DatabaseSeq, referencedAt: number): { object: PiledriverHeapObject, seq: DatabaseSeq } => {
    const keyBase64 = encodeBase64(new Uint8Array(key));
    const existingEntry = heapObjectsByHeapKeyBase64.get(keyBase64);
    if (!options.disableHeapReadCache && existingEntry) {
      const existingObject = existingEntry.object.deref();
      if (existingObject) {
        // Re-observing this key while reading a (fresher) root re-confirms it as live, so bump the
        // shared liveness timestamp — never regress it to an older value.
        existingEntry.state.referencedAt = Math.max(existingEntry.state.referencedAt, referencedAt);
        return {
          object: existingObject,
          seq: existingEntry.seq,
        };
      } else {
        // object has been gc'd, let's not return it from cache and just fetch it again below
      }
    }

    const state: HeapReferenceState = { referencedAt };
    let loadPromise: Promise<PiledriverObject> | undefined;
    const heapObj: PiledriverHeapObject = {
      async get() {
        const age = performance.now() - state.referencedAt;
        if (age > heapReferenceMaxAgeMs) {
          throw new Error(`Piledriver heap reference expired: last known referenced from a live root ${age.toFixed(0)}ms ago, which exceeds the configured heapReferenceMaxAgeMs=${heapReferenceMaxAgeMs}ms. This snapshot/handle outlived the garbage-collection grace period and its heap object may have been collected; re-fetch from a fresh root.`);
        }
        loadPromise ??= traceSpanHot({ description: "bulldozer-js.piledriver.heap.get", attributes: { "bulldozer.piledriver.heap_read_cache_disabled": options.disableHeapReadCache === true } }, async () => {
          const { buffer, seq: heapSeq } = await heapDump.get(key);
          if (buffer === null) throw new Error(`Assertion error: Heap object with base64 key "${keyBase64}" not found`);
          // Children inherit this handle's (possibly refreshed) liveness timestamp; see the note above.
          const deserialized = await deserializePiledriverObject(buffer, heapSeq, state.referencedAt);
          return deserialized.object;
        });
        try {
          return await loadPromise;
        } catch (error) {
          loadPromise = undefined;
          throw error;
        }
      },
      [isPiledriverHeapObjectSymbol]: true,
    };
    heapKeysAndSeqByHeapObjects.set(heapObj, { promise: Promise.resolve({ key, seq }), state });
    if (!options.disableHeapReadCache) {
      cacheHeapObjectByKey(key, heapObj, seq, state);
    }
    return { object: heapObj, seq };
  };

  // A heap reference discovered during the synchronous payload walk. The jsonable slot is
  // created immediately (as ["heap-reference", null]) and patched with the base64 key once the
  // referenced heap object has been resolved/inserted.
  type PendingHeapReferenceSlot = {
    slot: [string, string | null],
    heapObj: PiledriverHeapObject,
    branchKey: string | undefined,
  };

  // Serializes a Piledriver object in two phases:
  //  1. A fully SYNCHRONOUS walk that builds the jsonable structure, detects plain-object
  //     cycles (push/pop set — safe because nothing interleaves during a sync walk), counts
  //     stats, and records one slot per heap reference.
  //  2. Resolution of the (deduplicated) referenced heap objects in parallel, then patching
  //     their base64 keys into the recorded slots.
  // This replaces a previous fully-async recursive serializer that allocated promises for every
  // node and called lowLevelDb.combineSeqs once per array/object node (each combined seq
  // allocates a UUID, tracking promises, and map entries). Profiling showed that overhead — not
  // LMDB — dominated CPU during backfills, so seqs are now combined exactly once per heap
  // object/root, and only heap references involve async work at all.
  const serializePiledriverObject = async (obj: PiledriverObject, heapPath: HeapSerializationPath, serializationTimingStats: PiledriverSerializationTimingStats | undefined, inheritedBranchKey?: string): Promise<{ buffer: ArrayBuffer, seq: DatabaseSeq }> => {
    const stats = serializationTimingStats;
    const pendingSlots: PendingHeapReferenceSlot[] = [];
    const objectPath = new Set<object>();
    // Branch keys only depend on the first 3 path segments (see serializationBranchKey), so we
    // stop tracking the key path once the branch is determined. Nested heap objects inherit the
    // branch key of their reference site, which is equivalent to the old logicalPath threading
    // because heap references only occur at depth >= 3 in the root snapshot.
    const keyPath: string[] = [];

    const build = (node: PiledriverObject, branch: PiledriverSerializationBranchStats | undefined, branchKey: string | undefined, branchDetermined: boolean): unknown => {
      switch (typeof node) {
        case "number": {
          if (stats !== undefined) {
            stats.primitiveNodes++;
            if (branch !== undefined) branch.primitiveNodes++;
          }
          if (!Number.isFinite(node)) return [node.toString()];
          if (Object.is(node, -0)) return ["-0"];
          return node;
        }
        case "string":
        case "boolean": {
          if (stats !== undefined) {
            stats.primitiveNodes++;
            if (branch !== undefined) branch.primitiveNodes++;
          }
          return node;
        }
        case "object": {
          if (node === null) {
            if (stats !== undefined) {
              stats.primitiveNodes++;
              if (branch !== undefined) branch.primitiveNodes++;
            }
            return node;
          } else if (Array.isArray(node)) {
            if (stats !== undefined) {
              stats.arrayNodes++;
              stats.arrayItems += node.length;
              if (branch !== undefined) branch.arrayNodes++;
            }
            if (objectPath.has(node)) throw new Error("Piledriver objects must not contain cycles");
            objectPath.add(node);
            const items = node.map(item => build(item, branch, branchKey, branchDetermined));
            objectPath.delete(node);
            return ["array", items];
          } else if (isPiledriverHeapObjectSymbol in node) {
            if (stats !== undefined) {
              stats.heapReferenceNodes++;
              if (branch !== undefined) branch.heapReferenceNodes++;
            }
            // Fail fast on heap cycles at walk time (resolution would deadlock on the ancestor's
            // own memoized promise otherwise).
            if (heapPath.has(node)) throw new Error("Piledriver objects must not contain cycles (found a cycle of heap objects)");
            const slot: [string, string | null] = [PILEDRIVER_HEAP_REFERENCE_MARKER, null];
            pendingSlots.push({ slot, heapObj: node, branchKey });
            return slot;
          } else {
            // "normal" object
            // TODO: assert this is a POJO

            if (objectPath.has(node)) throw new Error("Piledriver objects must not contain cycles");
            objectPath.add(node);
            const entries = Object.entries(node);
            if (stats !== undefined) {
              stats.objectNodes++;
              stats.objectEntries += entries.length;
              if (branch !== undefined) {
                branch.objectNodes++;
                branch.objectEntries += entries.length;
              }
            }
            const result: Record<string, unknown> = {};
            for (const [k, v] of entries) {
              let childBranch = branch;
              let childBranchKey = branchKey;
              let childBranchDetermined = branchDetermined;
              if (!branchDetermined) {
                keyPath.push(k);
                childBranchKey = serializationBranchKey(keyPath);
                childBranch = stats === undefined ? undefined : serializationBranchStatsByKey(stats, childBranchKey);
                childBranchDetermined = keyPath.length >= 3;
              }
              result[k] = build(v, childBranch, childBranchKey, childBranchDetermined);
              if (!branchDetermined) keyPath.pop();
            }
            objectPath.delete(node);
            return result;
          }
        }
        default: {
          throw new Error("Assertion error: Unknown type of Piledriver object " + typeof node);
        }
      }
    };

    const toJsonableStartedAt = performance.now();
    const inheritedBranch = inheritedBranchKey === undefined ? undefined : serializationBranchStatsByKey(stats, inheritedBranchKey);
    const jsonableObject = build(obj, inheritedBranch, inheritedBranchKey, inheritedBranchKey !== undefined);
    if (stats !== undefined) stats.serializeToJsonableTotalMs += performance.now() - toJsonableStartedAt;

    let seq = lowLevelDb.initialSeq;
    if (pendingSlots.length > 0) {
      // Resolve each distinct heap object once, even if it is referenced from multiple slots.
      const slotsByHeapObj = new Map<PiledriverHeapObject, PendingHeapReferenceSlot[]>();
      for (const pendingSlot of pendingSlots) {
        const existing = slotsByHeapObj.get(pendingSlot.heapObj);
        if (existing === undefined) slotsByHeapObj.set(pendingSlot.heapObj, [pendingSlot]);
        else existing.push(pendingSlot);
      }
      const resolvedSeqs = await Promise.all([...slotsByHeapObj.entries()].map(async ([heapObj, slots]) => {
        const heapKeyAndSeq = await getHeapKeyAndSeq(heapObj, heapPath, stats, slots[0].branchKey);
        const keyBase64 = encodeBase64(new Uint8Array(heapKeyAndSeq.key));
        for (const { slot } of slots) slot[1] = keyBase64;
        return heapKeyAndSeq.seq;
      }));
      seq = combineSeqsDeduped(resolvedSeqs);
    }

    const jsonStringifyStartedAt = performance.now();
    const json = JSON.stringify(jsonableObject);
    if (stats !== undefined) stats.jsonStringifyTotalMs += performance.now() - jsonStringifyStartedAt;
    const textEncodeStartedAt = performance.now();
    const buffer = textEncoder.encode(json).buffer;
    if (stats !== undefined) stats.textEncodeTotalMs += performance.now() - textEncodeStartedAt;
    return { buffer, seq };
  };

  // Fully synchronous (getHeapObjectByKey is sync; heap payloads are only fetched lazily on
  // .get()). Seqs are collected into one array and combined once per buffer instead of once per
  // node — see serializePiledriverObject for why this matters.
  const deserializePiledriverObjectFromJsonableObject = (jsonableObject: unknown, enclosingSeq: DatabaseSeq, seqs: DatabaseSeq[], referencedAt: number): PiledriverObject => {
    switch (typeof jsonableObject) {
      case "string":
      case "number":
      case "boolean": {
        return jsonableObject;
      }
      case "object": {
        if (jsonableObject === null) {
          return jsonableObject;
        } else if (Array.isArray(jsonableObject)) {
          switch (jsonableObject[0]) {
            case "array": {
              // any: JSON.parse output is structurally validated by the surrounding switch; a malformed
              // payload would throw in the recursive call rather than silently passing through.
              return jsonableObject[1].map((o: any) => deserializePiledriverObjectFromJsonableObject(o, enclosingSeq, seqs, referencedAt));
            }
            case PILEDRIVER_HEAP_REFERENCE_MARKER: {
              const heapObjAndSeq = getHeapObjectByKey(decodeBase64(jsonableObject[1]).buffer, enclosingSeq, referencedAt);
              seqs.push(heapObjAndSeq.seq);
              return heapObjAndSeq.object;
            }
            case "NaN": {
              return NaN;
            }
            case "Infinity": {
              return Infinity;
            }
            case "-Infinity": {
              return -Infinity;
            }
            case "-0": {
              return -0;
            }
            default: {
              throw new Error("Assertion error: Serialized Piledriver JSONable object array has unknown type " + jsonableObject[0]);
            }
          }
        } else {
          const result: Record<string, PiledriverObject> = {};
          for (const [k, v] of Object.entries(jsonableObject)) {
            result[k] = deserializePiledriverObjectFromJsonableObject(v, enclosingSeq, seqs, referencedAt);
          }
          return result;
        }
      }
      default: {
        throw new Error("Assertion error: Unknown type of serialized Piledriver JSONable object " + typeof jsonableObject);
      }
    }
  };

  // `referencedAt` is the `performance.now()` moment at which the object being deserialized was known
  // to be reachable from a live root (see getHeapObjectByKey). Callers reading the current root pass
  // `performance.now()`; a lazy child load inherits its parent handle's stamp.
  const deserializePiledriverObject = async (buffer: ArrayBuffer, enclosingSeq: DatabaseSeq, referencedAt: number): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> => {
    const seqs: DatabaseSeq[] = [];
    const object = deserializePiledriverObjectFromJsonableObject(JSON.parse(textDecoder.decode(buffer)), enclosingSeq, seqs, referencedAt);
    return { object, seq: combineSeqsDeduped(seqs) };
  };

  const parseDebugEntryValue = (valueUtf8: string | null) => {
    if (valueUtf8 === null) return null;
    try {
      return JSON.parse(valueUtf8);
    } catch {
      return valueUtf8;
    }
  };

  return {
    getDebugInfo() {
      return {
        backend: "piledriver",
        constructorArguments: { lowLevelDb, options },
        lowLevelDb,
        rootStore,
        heapDump,
        heapObjectsByObject,
        heapObjectsByHeapKeyBase64,
        heapObjectsByHeapKeyFinalizer,
        heapKeysAndSeqByHeapObjects,
        heapReadCacheDisabled: options.disableHeapReadCache === true,
      };
    },
    async getRootObject(key): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> {
      return await traceSpan("bulldozer-js.piledriver.getRootObject", async () => {
        const { buffer, seq: rootSeq } = await rootStore.get(key);
        if (buffer === null) throw new Error("Root object not found");
        // Reading the current root confirms its whole closure as live right now, so its handles
        // (and their lazily-loaded descendants) are stamped with `performance.now()`.
        const { object, seq: deserializeSeq } = await deserializePiledriverObject(buffer, rootSeq, performance.now());
        return { object, seq: lowLevelDb.combineSeqs(deserializeSeq, rootSeq) };
      });
    },
    async setRootObject(key, value): Promise<{ seq: DatabaseSeq }> {
      return await traceSpan("bulldozer-js.piledriver.setRootObject", async () => {
        const timingStats = emptyPiledriverSerializationTimingStats();
        const startedAt = performance.now();
        const serializeStartedAt = performance.now();
        const serializeCpuStartedAt = process.cpuUsage();
        const { buffer, seq } = await serializePiledriverObject(value, new Set(), timingStats);
        const serializeCpuUsage = process.cpuUsage(serializeCpuStartedAt);
        const serializePiledriverObjectMs = performance.now() - serializeStartedAt;
        const serializeCpuMs = (serializeCpuUsage.user + serializeCpuUsage.system) / 1000;
        const rootStoreSetAllStartedAt = performance.now();
        const { seq: rootSeq } = await rootStore.setAll([{ key, value: buffer }], { requiresSeq: seq });
        const rootStoreSetAllMs = performance.now() - rootStoreSetAllStartedAt;
        if (rootHistoryStore !== null) {
          // Append this committed root (same serialized buffer) to the append-only history so the GC
          // can keep every object reachable from any root committed within its retention window.
          // requiresSeq: seq ensures the history entry can only become durable once the heap objects
          // it references are durable. The current root always stays in rootStore; history entries
          // are pruned by the GC once they age out of the window.
          await rootHistoryStore.setAll([{ key: encodeRootHistoryKey(Date.now()), value: buffer }], { requiresSeq: seq });
        }
        const topSerializationBranches = [...timingStats.branchStats.entries()]
          .map(([branch, stats]) => ({
            branch,
            totalNodes: stats.primitiveNodes + stats.arrayNodes + stats.objectNodes + stats.heapReferenceNodes,
            primitiveNodes: stats.primitiveNodes,
            arrayNodes: stats.arrayNodes,
            objectNodes: stats.objectNodes,
            objectEntries: stats.objectEntries,
            heapReferenceNodes: stats.heapReferenceNodes,
            heapObjectCacheHits: stats.heapObjectCacheHits,
            heapObjectCacheMisses: stats.heapObjectCacheMisses,
            topHeapObjectCacheMissShapes: [...stats.heapObjectCacheMissesByShape.entries()]
              .map(([shape, count]) => {
                const totalInlineNodeCount = stats.heapObjectCacheMissInlineNodeCountsByShape.get(shape) ?? 0;
                return { shape, count, totalInlineNodeCount, averageInlineNodeCount: count === 0 ? 0 : totalInlineNodeCount / count };
              })
              .sort((a, b) => b.count - a.count)
              .slice(0, 5),
          }))
          .sort((a, b) => b.totalNodes - a.totalNodes)
          .slice(0, 5);
        const topHeapObjectCacheMissShapes = [...timingStats.heapObjectCacheMissesByShape.entries()]
          .map(([shape, count]) => {
            const totalInlineNodeCount = timingStats.heapObjectCacheMissInlineNodeCountsByShape.get(shape) ?? 0;
            return { shape, count, totalInlineNodeCount, averageInlineNodeCount: count === 0 ? 0 : totalInlineNodeCount / count };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        if (!shouldSuppressPeriodicBulldozerLogs) {
          console.debug("bulldozer-js piledriver setRootObject timing", {
            elapsedMs: performance.now() - startedAt,
            serializePiledriverObjectMs,
            serializeCpuMs,
            serializeCpuToWallRatio: serializePiledriverObjectMs === 0 ? 0 : serializeCpuMs / serializePiledriverObjectMs,
            rootStoreSetAllMs,
            rootValueBytes: buffer.byteLength,
            primitiveNodes: timingStats.primitiveNodes,
            arrayNodes: timingStats.arrayNodes,
            arrayItems: timingStats.arrayItems,
            objectNodes: timingStats.objectNodes,
            objectEntries: timingStats.objectEntries,
            heapReferenceNodes: timingStats.heapReferenceNodes,
            serializeToJsonableTotalMs: timingStats.serializeToJsonableTotalMs,
            jsonStringifyTotalMs: timingStats.jsonStringifyTotalMs,
            textEncodeTotalMs: timingStats.textEncodeTotalMs,
            heapObjectCacheHits: timingStats.heapObjectCacheHits,
            heapObjectCacheMisses: timingStats.heapObjectCacheMisses,
            heapObjectCacheHitAwaitTotalMs: timingStats.heapObjectCacheHitAwaitTotalMs,
            heapObjectCacheMissAwaitTotalMs: timingStats.heapObjectCacheMissAwaitTotalMs,
            heapObjectGetTotalMs: timingStats.heapObjectGetTotalMs,
            heapObjectSerializeTotalMs: timingStats.heapObjectSerializeTotalMs,
            heapObjectInsertAwaitTotalMs: timingStats.heapObjectInsertAwaitTotalMs,
            topHeapObjectCacheMissShapes,
            topSerializationBranches,
          });
        }
        return { seq: rootSeq };
      });
    },
    async deleteRootObject(key): Promise<{ seq: DatabaseSeq }> {
      return await traceSpan("bulldozer-js.piledriver.deleteRootObject", async () => {
        const { seq } = await rootStore.deleteAll([key]);
        return { seq };
      });
    },
    combineSeqs(...seqs) {
      return lowLevelDb.combineSeqs(...seqs);
    },
    waitUntilAvailable(seq) {
      return traceSpan("bulldozer-js.piledriver.waitUntilAvailable", async () => await lowLevelDb.waitUntilAvailable(seq));
    },
    waitUntilDurable(seq) {
      return traceSpan("bulldozer-js.piledriver.waitUntilDurable", async () => await lowLevelDb.waitUntilDurable(seq));
    },
    waitUntilReplicated(seq) {
      return traceSpan("bulldozer-js.piledriver.waitUntilReplicated", async () => await lowLevelDb.waitUntilReplicated(seq));
    },
    async debugSnapshot() {
      return await traceSpan("bulldozer-js.piledriver.debugSnapshot", async () => ({
        roots: (await rootStore.debugEntries?.() ?? []).map(entry => ({
          keyBase64: entry.keyBase64,
          keyUtf8: entry.keyUtf8,
          keyHex: entry.keyHex,
          serializedJson: parseDebugEntryValue(entry.valueUtf8),
          valueByteLength: entry.valueByteLength,
        })),
        heap: (await heapDump.debugEntries?.() ?? []).map(entry => ({
          keyBase64: entry.keyBase64,
          keyUtf8: entry.keyUtf8,
          keyHex: entry.keyHex,
          serializedJson: parseDebugEntryValue(entry.valueUtf8),
          valueByteLength: entry.valueByteLength,
        })),
      }));
    },
    async debugLowLevelSnapshot() {
      return await traceSpan("bulldozer-js.piledriver.debugLowLevelSnapshot", async () => await lowLevelDb.debugSnapshot?.() ?? { stores: {}, dumps: {} });
    },
    initialSeq: lowLevelDb.initialSeq,
  };
}
