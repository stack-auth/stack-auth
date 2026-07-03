import { decodeBase64, encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { traceSpan } from "../../otel.js";
import { Database, DatabaseSeq } from "../index.js";
import { LowLevelDatabase, LowLevelDatabaseDebugSnapshot } from "../low-level/index.js";

export const isPiledriverHeapObjectSymbol = Symbol.for("hexclave-piledriver-heap-object-symbol");
export type PiledriverHeapObject = {
  get(): Promise<PiledriverObject>,
  [isPiledriverHeapObjectSymbol]: true,
};

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
};

// Tracks the chain of objects currently being serialized, so cycles fail fast with a clear
// error instead of hanging (a heap cycle would deadlock on its own memoized promise, and a
// plain object cycle would recurse forever). Sibling/DAG sharing is fine: only true ancestors
// are in the path.
type SerializationPath = {
  objects: Set<object>,
  heapObjects: Set<PiledriverHeapObject>,
};
const emptySerializationPath = (): SerializationPath => ({ objects: new Set(), heapObjects: new Set() });
type PendingHeapInsert = {
  buffer: ArrayBuffer,
  requiresSeq: DatabaseSeq,
  serializationTimingStats: PiledriverSerializationTimingStats | undefined,
  resolve: (value: { key: ArrayBuffer, seq: DatabaseSeq }) => void,
  reject: (error: unknown) => void,
};
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
  heapInsertFlushes: number,
  heapInsertValues: number,
  heapInsertAllTotalMs: number,
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
    heapInsertFlushes: 0,
    heapInsertValues: 0,
    heapInsertAllTotalMs: 0,
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

function serializationBranchStats(stats: PiledriverSerializationTimingStats | undefined, path: readonly string[]) {
  if (stats === undefined) return undefined;
  const key = serializationBranchKey(path);
  let result = stats.branchStats.get(key);
  if (result === undefined) {
    result = emptyPiledriverSerializationBranchStats();
    stats.branchStats.set(key, result);
  }
  return result;
}

export function declarePiledriverDatabase(lowLevelDb: LowLevelDatabase, options: PiledriverDatabaseOptions = {}): PiledriverDatabase {
  // TODO actually support cycles both for heap and non-heap objects (right now they are detected and rejected)

  const rootStore = lowLevelDb.declareKvStore("root");
  const heapDump = lowLevelDb.declareKvDump("heap");

  const heapObjectsByHeapKeyBase64 = new Map<string, { refIdentity: string, object: WeakRef<PiledriverHeapObject>, seq: DatabaseSeq }>();
  const heapObjectsByHeapKeyFinalizer = new FinalizationRegistry(([keyBase64, refIdentity]: [string, string]) => heapObjectsByHeapKeyBase64.get(keyBase64)?.refIdentity === refIdentity && heapObjectsByHeapKeyBase64.delete(keyBase64));
  const heapKeysAndSeqByHeapObjects = new WeakMap<PiledriverHeapObject, Promise<{ key: ArrayBuffer, seq: DatabaseSeq }>>();
  let pendingHeapInserts: PendingHeapInsert[] = [];
  let heapInsertFlushScheduled = false;

  const cacheHeapObjectByKey = (key: ArrayBuffer, heapObj: PiledriverHeapObject, seq: DatabaseSeq) => {
    const keyBase64 = encodeBase64(new Uint8Array(key));
    const refIdentity = crypto.randomUUID();
    heapObjectsByHeapKeyBase64.set(keyBase64, { refIdentity, object: new WeakRef(heapObj), seq });
    heapObjectsByHeapKeyFinalizer.register(heapObj, [keyBase64, refIdentity]);
  };
  const flushPendingHeapInserts = async () => {
    const batch = pendingHeapInserts;
    pendingHeapInserts = [];
    heapInsertFlushScheduled = false;
    if (batch.length === 0) return;

    try {
      const entriesBySerializationTimingStats = new Map<PiledriverSerializationTimingStats, number>();
      for (const entry of batch) {
        if (entry.serializationTimingStats !== undefined) {
          entriesBySerializationTimingStats.set(entry.serializationTimingStats, (entriesBySerializationTimingStats.get(entry.serializationTimingStats) ?? 0) + 1);
        }
      }
      const heapInsertAllStartedAt = performance.now();
      const inserted = await heapDump.insertAll(batch.map(entry => entry.buffer));
      const heapInsertAllMs = performance.now() - heapInsertAllStartedAt;
      for (const [stats, entryCount] of entriesBySerializationTimingStats) {
        stats.heapInsertFlushes++;
        stats.heapInsertValues += entryCount;
        stats.heapInsertAllTotalMs += heapInsertAllMs * entryCount / batch.length;
      }
      for (let i = 0; i < batch.length; i++) {
        batch[i].resolve({ key: inserted.keys[i], seq: lowLevelDb.combineSeqs(batch[i].requiresSeq, inserted.seq) });
      }
    } catch (error) {
      for (const entry of batch) entry.reject(error);
    }
  };
  const insertHeapObjectBatched = async (buffer: ArrayBuffer, requiresSeq: DatabaseSeq, serializationTimingStats: PiledriverSerializationTimingStats | undefined): Promise<{ key: ArrayBuffer, seq: DatabaseSeq }> => {
    return await new Promise((resolve, reject) => {
      pendingHeapInserts.push({ buffer, requiresSeq, serializationTimingStats, resolve, reject });
      if (!heapInsertFlushScheduled) {
        heapInsertFlushScheduled = true;
        const timeout = setTimeout(() => {
          runAsynchronously(async () => await flushPendingHeapInserts());
        }, 0);
        timeout.unref();
      }
    });
  };

  const getHeapKeyAndSeq = async (heapObj: PiledriverHeapObject, path: SerializationPath = emptySerializationPath(), serializationTimingStats?: PiledriverSerializationTimingStats, logicalPath: readonly string[] = []): Promise<{ key: ArrayBuffer, seq: DatabaseSeq }> => {
    // Must be checked before the memo lookup: awaiting the memoized promise of an ancestor
    // that is still being serialized would deadlock.
    if (path.heapObjects.has(heapObj)) throw new Error("Piledriver objects must not contain cycles (found a cycle of heap objects)");

    const existing = heapKeysAndSeqByHeapObjects.get(heapObj);
    if (existing) {
      if (serializationTimingStats !== undefined) {
        serializationTimingStats.heapObjectCacheHits++;
        const branch = serializationBranchStats(serializationTimingStats, logicalPath);
        if (branch !== undefined) branch.heapObjectCacheHits++;
      }
      const cacheHitAwaitStartedAt = performance.now();
      try {
        return await existing;
      } finally {
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectCacheHitAwaitTotalMs += performance.now() - cacheHitAwaitStartedAt;
      }
    }
    if (serializationTimingStats !== undefined) {
      serializationTimingStats.heapObjectCacheMisses++;
      const branch = serializationBranchStats(serializationTimingStats, logicalPath);
      if (branch !== undefined) branch.heapObjectCacheMisses++;
    }

    const promise = (async () => {
      // A heap object starts a fresh plain-object path; plain object cycles can't span heap
      // boundaries without also forming a heap cycle, which is tracked separately.
      const childPath: SerializationPath = { objects: new Set(), heapObjects: new Set(path.heapObjects).add(heapObj) };
      return await traceSpan("bulldozer-js.piledriver.heap.serializeAndInsert", async () => {
        const heapObjectGetStartedAt = performance.now();
        const heapObject = await heapObj.get();
        let shape: string | undefined;
        if (serializationTimingStats !== undefined) {
          shape = classifyHeapObjectPayload(heapObject);
          const inlineNodeCount = totalInlineNodes(countPiledriverInlineNodes(heapObject));
          incrementMapCount(serializationTimingStats.heapObjectCacheMissesByShape, shape);
          addMapCount(serializationTimingStats.heapObjectCacheMissInlineNodeCountsByShape, shape, inlineNodeCount);
          const branch = serializationBranchStats(serializationTimingStats, logicalPath);
          if (branch !== undefined) {
            incrementMapCount(branch.heapObjectCacheMissesByShape, shape);
            addMapCount(branch.heapObjectCacheMissInlineNodeCountsByShape, shape, inlineNodeCount);
          }
        }
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectGetTotalMs += performance.now() - heapObjectGetStartedAt;
        const heapObjectSerializeStartedAt = performance.now();
        const serialized = await serializePiledriverObject(heapObject, childPath, serializationTimingStats, logicalPath);
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectSerializeTotalMs += performance.now() - heapObjectSerializeStartedAt;
        const heapObjectInsertStartedAt = performance.now();
        const result = await insertHeapObjectBatched(serialized.buffer, serialized.seq, serializationTimingStats);
        if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectInsertAwaitTotalMs += performance.now() - heapObjectInsertStartedAt;
        return result;
      });
    })();
    heapKeysAndSeqByHeapObjects.set(heapObj, promise);
    let result;
    const cacheMissAwaitStartedAt = performance.now();
    try {
      result = await promise;
    } catch (error) {
      // Don't leave a poisoned rejected promise in the cache; a later retry may succeed.
      if (heapKeysAndSeqByHeapObjects.get(heapObj) === promise) heapKeysAndSeqByHeapObjects.delete(heapObj);
      throw error;
    } finally {
      if (serializationTimingStats !== undefined) serializationTimingStats.heapObjectCacheMissAwaitTotalMs += performance.now() - cacheMissAwaitStartedAt;
    }
    cacheHeapObjectByKey(result.key, heapObj, result.seq);
    return result;
  };

  const getHeapObjectByKey = (key: ArrayBuffer, seq: DatabaseSeq): { object: PiledriverHeapObject, seq: DatabaseSeq } => {
    const keyBase64 = encodeBase64(new Uint8Array(key));
    const existingEntry = heapObjectsByHeapKeyBase64.get(keyBase64);
    if (!options.disableHeapReadCache && existingEntry) {
      const existingObject = existingEntry.object.deref();
      if (existingObject) {
        return {
          object: existingObject,
          seq: existingEntry.seq,
        };
      } else {
        // object has been gc'd, let's not return it from cache and just fetch it again below
      }
    }

    let loadPromise: Promise<PiledriverObject> | undefined;
    const heapObj: PiledriverHeapObject = {
      async get() {
        loadPromise ??= traceSpan({ description: "bulldozer-js.piledriver.heap.get", attributes: { "bulldozer.piledriver.heap_read_cache_disabled": options.disableHeapReadCache === true } }, async () => {
          const { buffer, seq: heapSeq } = await heapDump.get(key);
          if (buffer === null) throw new Error(`Assertion error: Heap object with base64 key "${keyBase64}" not found`);
          const deserialized = await deserializePiledriverObject(buffer, heapSeq);
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
    heapKeysAndSeqByHeapObjects.set(heapObj, Promise.resolve({ key, seq }));
    if (!options.disableHeapReadCache) {
      cacheHeapObjectByKey(key, heapObj, seq);
    }
    return { object: heapObj, seq };
  };

  const serializePiledriverObjectToJsonableObject = async (obj: PiledriverObject, path: SerializationPath, serializationTimingStats?: PiledriverSerializationTimingStats, logicalPath: readonly string[] = []): Promise<{ jsonableObject: unknown, seq: DatabaseSeq }> => {
    switch (typeof obj) {
      case "number": {
        if (serializationTimingStats !== undefined) {
          serializationTimingStats.primitiveNodes++;
          const branch = serializationBranchStats(serializationTimingStats, logicalPath);
          if (branch !== undefined) branch.primitiveNodes++;
        }
        if (!Number.isFinite(obj)) return { jsonableObject: [obj.toString()], seq: lowLevelDb.initialSeq };
        if (Object.is(obj, -0)) return { jsonableObject: ["-0"], seq: lowLevelDb.initialSeq };
        // intentionally fall through to the primitive case below
      }
      case "string":
      case "boolean": {
        if (serializationTimingStats !== undefined && typeof obj !== "number") {
          serializationTimingStats.primitiveNodes++;
          const branch = serializationBranchStats(serializationTimingStats, logicalPath);
          if (branch !== undefined) branch.primitiveNodes++;
        }
        return { jsonableObject: obj, seq: lowLevelDb.initialSeq };
      }
      case "object": {
        if (obj === null) {
          if (serializationTimingStats !== undefined) {
            serializationTimingStats.primitiveNodes++;
            const branch = serializationBranchStats(serializationTimingStats, logicalPath);
            if (branch !== undefined) branch.primitiveNodes++;
          }
          return { jsonableObject: obj, seq: lowLevelDb.initialSeq };
        } else if (Array.isArray(obj)) {
          if (serializationTimingStats !== undefined) {
            serializationTimingStats.arrayNodes++;
            serializationTimingStats.arrayItems += obj.length;
            const branch = serializationBranchStats(serializationTimingStats, logicalPath);
            if (branch !== undefined) branch.arrayNodes++;
          }
          if (path.objects.has(obj)) throw new Error("Piledriver objects must not contain cycles");
          const childPath: SerializationPath = { ...path, objects: new Set(path.objects).add(obj) };
          const itemsSerializeResults = await Promise.all(obj.map(async o => await serializePiledriverObjectToJsonableObject(o, childPath, serializationTimingStats, logicalPath)));
          return {
            jsonableObject: ["array", itemsSerializeResults.map(r => r.jsonableObject)],
            seq: lowLevelDb.combineSeqs(...itemsSerializeResults.map(r => r.seq)),
          };
        } else if (isPiledriverHeapObjectSymbol in obj) {
          if (serializationTimingStats !== undefined) {
            serializationTimingStats.heapReferenceNodes++;
            const branch = serializationBranchStats(serializationTimingStats, logicalPath);
            if (branch !== undefined) branch.heapReferenceNodes++;
          }
          const heapKeyAndSeq = await getHeapKeyAndSeq(obj, path, serializationTimingStats, logicalPath);
          return {
            jsonableObject: ["heap-reference", encodeBase64(new Uint8Array(heapKeyAndSeq.key))],
            seq: heapKeyAndSeq.seq,
          };
        } else {
          // "normal" object
          // TODO: assert this is a POJO

          if (path.objects.has(obj)) throw new Error("Piledriver objects must not contain cycles");
          const childPath: SerializationPath = { ...path, objects: new Set(path.objects).add(obj) };
          const entries = Object.entries(obj);
          if (serializationTimingStats !== undefined) {
            serializationTimingStats.objectNodes++;
            serializationTimingStats.objectEntries += entries.length;
            const branch = serializationBranchStats(serializationTimingStats, logicalPath);
            if (branch !== undefined) {
              branch.objectNodes++;
              branch.objectEntries += entries.length;
            }
          }
          const entriesSerializeResults = await Promise.all(entries.map(async ([k, v]) => [k, await serializePiledriverObjectToJsonableObject(v, childPath, serializationTimingStats, [...logicalPath, k])] as const));
          return {
            jsonableObject: Object.fromEntries(entriesSerializeResults.map(([k, v]) => [k, v.jsonableObject] as const)),
            seq: lowLevelDb.combineSeqs(...entriesSerializeResults.map(([_, v]) => v.seq)),
          };
        }
      }
      default: {
        throw new Error("Assertion error: Unknown type of Piledriver object " + typeof obj);
      }
    }
  };

  const serializePiledriverObject = async (obj: PiledriverObject, path: SerializationPath = emptySerializationPath(), serializationTimingStats?: PiledriverSerializationTimingStats, logicalPath: readonly string[] = []): Promise<{ buffer: ArrayBuffer, seq: DatabaseSeq }> => {
    const toJsonableStartedAt = performance.now();
    const toJsonableResponse = await serializePiledriverObjectToJsonableObject(obj, path, serializationTimingStats, logicalPath);
    if (serializationTimingStats !== undefined) serializationTimingStats.serializeToJsonableTotalMs += performance.now() - toJsonableStartedAt;
    const jsonStringifyStartedAt = performance.now();
    const json = JSON.stringify(toJsonableResponse.jsonableObject);
    if (serializationTimingStats !== undefined) serializationTimingStats.jsonStringifyTotalMs += performance.now() - jsonStringifyStartedAt;
    const textEncodeStartedAt = performance.now();
    const buffer = new TextEncoder().encode(json).buffer;
    if (serializationTimingStats !== undefined) serializationTimingStats.textEncodeTotalMs += performance.now() - textEncodeStartedAt;
    return {
      buffer,
      seq: toJsonableResponse.seq,
    };
  };

  const deserializePiledriverObjectFromJsonableObject = async (jsonableObject: unknown, enclosingSeq: DatabaseSeq): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> => {
    switch (typeof jsonableObject) {
      case "string":
      case "number":
      case "boolean": {
        return { object: jsonableObject, seq: lowLevelDb.initialSeq };
      }
      case "object": {
        if (jsonableObject === null) {
          return { object: jsonableObject, seq: lowLevelDb.initialSeq };
        } else if (Array.isArray(jsonableObject)) {
          switch (jsonableObject[0]) {
            case "array": {
              const itemsDeserializeResults = await Promise.all(jsonableObject[1].map(async (o: any) => await deserializePiledriverObjectFromJsonableObject(o, enclosingSeq)));
              return { object: itemsDeserializeResults.map(r => r.object), seq: lowLevelDb.combineSeqs(...itemsDeserializeResults.map(r => r.seq)) };
            }
            case "heap-reference": {
              const heapObjAndSeq = getHeapObjectByKey(decodeBase64(jsonableObject[1]).buffer, enclosingSeq);
              return { object: heapObjAndSeq.object, seq: heapObjAndSeq.seq };
            }
            case "NaN": {
              return { object: NaN, seq: lowLevelDb.initialSeq };
            }
            case "Infinity": {
              return { object: Infinity, seq: lowLevelDb.initialSeq };
            }
            case "-Infinity": {
              return { object: -Infinity, seq: lowLevelDb.initialSeq };
            }
            case "-0": {
              return { object: -0, seq: lowLevelDb.initialSeq };
            }
            default: {
              throw new Error("Assertion error: Serialized Piledriver JSONable object array has unknown type " + jsonableObject[0]);
            }
          }
        } else {
          const entries = Object.entries(jsonableObject);
          const entriesDeserializeResults = await Promise.all(entries.map(async ([k, v]) => [k, await deserializePiledriverObjectFromJsonableObject(v, enclosingSeq)] as const));
          return {
            object: Object.fromEntries(entriesDeserializeResults.map(([k, v]) => [k, v.object] as const)),
            seq: lowLevelDb.combineSeqs(...entriesDeserializeResults.map(([_, v]) => v.seq)),
          };
        }
      }
      default: {
        throw new Error("Assertion error: Unknown type of serialized Piledriver JSONable object " + typeof jsonableObject);
      }
    }
  };

  const deserializePiledriverObject = async (buffer: ArrayBuffer, enclosingSeq: DatabaseSeq): Promise<{ object: PiledriverObject, seq: DatabaseSeq }> => {
    return await deserializePiledriverObjectFromJsonableObject(JSON.parse(new TextDecoder().decode(buffer)), enclosingSeq);
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
        const { object, seq: deserializeSeq } = await deserializePiledriverObject(buffer, rootSeq);
        return { object, seq: lowLevelDb.combineSeqs(deserializeSeq, rootSeq) };
      });
    },
    async setRootObject(key, value): Promise<{ seq: DatabaseSeq }> {
      return await traceSpan("bulldozer-js.piledriver.setRootObject", async () => {
        const timingStats = emptyPiledriverSerializationTimingStats();
        const startedAt = performance.now();
        const serializeStartedAt = performance.now();
        const serializeCpuStartedAt = process.cpuUsage();
        const { buffer, seq } = await serializePiledriverObject(value, emptySerializationPath(), timingStats);
        const serializeCpuUsage = process.cpuUsage(serializeCpuStartedAt);
        const serializePiledriverObjectMs = performance.now() - serializeStartedAt;
        const serializeCpuMs = (serializeCpuUsage.user + serializeCpuUsage.system) / 1000;
        const rootStoreSetAllStartedAt = performance.now();
        const { seq: rootSeq } = await rootStore.setAll([{ key, value: buffer }], { requiresSeq: seq });
        const rootStoreSetAllMs = performance.now() - rootStoreSetAllStartedAt;
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
          heapInsertFlushes: timingStats.heapInsertFlushes,
          heapInsertValues: timingStats.heapInsertValues,
          heapInsertAllTotalMs: timingStats.heapInsertAllTotalMs,
          topHeapObjectCacheMissShapes,
          topSerializationBranches,
        });
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
