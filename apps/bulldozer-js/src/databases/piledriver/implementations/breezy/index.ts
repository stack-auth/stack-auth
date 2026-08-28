import { DatabaseSeq } from "../../../index.js";
import { LowLevelDatabase } from "../../../low-level/index.js";
import { declarePiledriverGarbageCollector } from "../../gc.js";
import { heapObjectsByObject, PiledriverDatabase, PiledriverHeapObject, PiledriverObject } from "../../index.js";
import { decodePiledriverObject, encodePiledriverObject } from "./codec.js";
import { createPiledriverHeapCache, PiledriverHeapLocation } from "./heap-cache.js";

const breezyPiledriverProcessStartedAtMillis = Date.now();

export type BreezyPiledriverDatabaseOptions = { disableHeapReadCache?: boolean, garbageCollectionProcessStartedAtMillis?: number };

type CreatedHeap = PiledriverHeapLocation & { object: PiledriverHeapObject, buffer: ArrayBuffer };

export function declareBreezyPiledriverDatabase(lowLevelDb: LowLevelDatabase, options: BreezyPiledriverDatabaseOptions = {}): PiledriverDatabase {
  const processStartedAtMillis = options.garbageCollectionProcessStartedAtMillis ?? breezyPiledriverProcessStartedAtMillis;
  if (!Number.isSafeInteger(processStartedAtMillis) || processStartedAtMillis < 0) throw new Error("Piledriver garbageCollectionProcessStartedAtMillis must be a non-negative safe integer");

  const rootStore = lowLevelDb.declareKvStore("root");
  const heapDump = lowLevelDb.declareKvDump("heap");
  const garbageCollector = declarePiledriverGarbageCollector({ lowLevelDb, heapDump, processStartedAtMillis });
  const loadHeapObject = async (key: ArrayBuffer, keyBase64: string) => {
    const stored = await heapDump.get(key);
    if (stored.buffer === null) throw new Error(`Assertion error: Heap object with base64 key "${keyBase64}" not found`);
    return decodePiledriverObject(stored.buffer, childKey => heapCache.resolve(childKey, stored.seq));
  };
  const heapCache = createPiledriverHeapCache({ disabled: options.disableHeapReadCache === true, load: loadHeapObject });
  let lastRootWriteSeq = lowLevelDb.initialSeq;
  let mutations: Promise<unknown> = Promise.resolve();

  const combineSeqs = (seqs: Iterable<DatabaseSeq>) => {
    const unique = [...new Set(seqs)].filter(seq => seq !== lowLevelDb.initialSeq);
    if (unique.length < 2) return unique.length === 0 ? lowLevelDb.initialSeq : unique[0];
    return lowLevelDb.combineSeqs(...unique);
  };
  const withMutationLock = async <T>(operation: () => Promise<T>) => {
    const current = mutations.then(operation, operation);
    mutations = current;
    return await current;
  };

  const serialize = async (value: PiledriverObject, heapPath: ReadonlySet<PiledriverHeapObject>, created: CreatedHeap[]): Promise<{ buffer: ArrayBuffer, seq: DatabaseSeq }> => {
    const encoded = await encodePiledriverObject(value, heapPath, async (object, childHeapPath) => {
      let location = heapCache.getLocation(object);
      if (location === undefined) {
        const serialized = await serialize(await object.get(), childHeapPath, created);
        const inserted = await heapDump.insertAll([serialized.buffer], { requiresSeq: serialized.seq });
        const createdHeap: CreatedHeap = { object, key: inserted.keys[0], seq: inserted.seq, buffer: serialized.buffer };
        created.push(createdHeap);
        heapCache.remember(object, createdHeap);
        location = createdHeap;
      }
      return { key: location.key, dependency: location.seq };
    });
    return { buffer: encoded.buffer, seq: combineSeqs(encoded.dependencies) };
  };

  /**
   * Serializes a root value and makes every newly created heap object safe to reference.
   *
   * Heap payloads are inserted while serializing, but they are not reachable yet. Once the whole
   * graph is available, creation metadata is recorded for the batch and then every outgoing heap
   * edge is added to the GC reference counts. The returned sequence covers all three stages, so a
   * root can use it as the prerequisite for becoming visible.
   *
   * If serialization or publication fails, newly memoized locations are forgotten. Their payloads
   * may remain as unreachable storage, which is fail-safe; a retry must serialize fresh objects
   * instead of reusing locations whose GC metadata may be incomplete.
   */
  const serializeAndPublish = async (value: PiledriverObject) => {
    const created: CreatedHeap[] = [];
    try {
      const serialized = await serialize(value, new Set(), created);
      if (created.length === 0) return serialized;
      const creations = await garbageCollector.recordHeapObjectCreations(created.map(({ key, seq }) => ({ key, requiresSeq: seq })));
      const references = await garbageCollector.beforeSerializedHeapObjectsBecomeVisible(created.map(({ buffer }) => buffer), creations.seq);
      return { ...serialized, seq: combineSeqs([serialized.seq, references.seq]) };
    } catch (error) {
      for (const item of created) heapCache.forget(item.object, item);
      throw error;
    }
  };

  const readPreviousRoot = async (key: ArrayBuffer) => {
    const pendingWrite = lastRootWriteSeq;
    try {
      await lowLevelDb.waitUntilAvailable(pendingWrite);
    } catch (error) {
      if (lastRootWriteSeq === pendingWrite) lastRootWriteSeq = lowLevelDb.initialSeq;
      throw error;
    }
    return await rootStore.get(key);
  };

  return {
    getDebugInfo: () => ({ backend: "piledriver-breezy", constructorArguments: { lowLevelDb, options }, lowLevelDb, rootStore, heapDump, garbageCollector, processStartedAtMillis, heapObjectsByObject, heapObjectsByHeapKeyBase64: heapCache.objectsByKey, heapKeysAndSeqByHeapObjects: heapCache.locations, heapReadCacheDisabled: options.disableHeapReadCache === true }),
    async getRootObject(key) {
      const stored = await rootStore.get(key);
      if (stored.buffer === null) throw new Error("Root object not found");
      return { object: decodePiledriverObject(stored.buffer, heapKey => heapCache.resolve(heapKey, stored.seq)), seq: stored.seq };
    },
    async setRootObject(key, value) {
      return await withMutationLock(async () => {
        await garbageCollector.initialize();
        const previous = await readPreviousRoot(key);
        const serialized = await serializeAndPublish(value);
        const references = await garbageCollector.beforeSerializedObjectBecomesVisible(serialized.buffer, serialized.seq);
        const written = await rootStore.setAll([{ key, value: serialized.buffer }], { requiresSeq: references.seq });
        lastRootWriteSeq = written.seq;
        if (previous.buffer === null) return written;
        const dereferenced = await garbageCollector.afterSerializedObjectBecameInvisible(previous.buffer, Math.max(Date.now(), processStartedAtMillis), written.seq);
        return { seq: dereferenced.seq };
      });
    },
    async deleteRootObject(key) {
      return await withMutationLock(async () => {
        await garbageCollector.initialize();
        const previous = await readPreviousRoot(key);
        const deleted = await rootStore.deleteAll([key]);
        lastRootWriteSeq = deleted.seq;
        if (previous.buffer === null) return deleted;
        const dereferenced = await garbageCollector.afterSerializedObjectBecameInvisible(previous.buffer, Math.max(Date.now(), processStartedAtMillis), deleted.seq);
        return { seq: dereferenced.seq };
      });
    },
    getGarbageCollectionProcessStartedAtMillis: () => processStartedAtMillis,
    collectGarbage: (cutoffTimestampMillis, maxObjects) => garbageCollector.collectGarbage(cutoffTimestampMillis, maxObjects),
    combineSeqs: (...seqs) => lowLevelDb.combineSeqs(...seqs),
    close: () => lowLevelDb.close(),
    waitUntilAvailable: seq => lowLevelDb.waitUntilAvailable(seq),
    waitUntilDurable: seq => lowLevelDb.waitUntilDurable(seq),
    waitUntilReplicated: seq => lowLevelDb.waitUntilReplicated(seq),
    async debugSnapshot() {
      const mapEntry = (entry: { keyBase64: string, keyUtf8: string | null, keyHex: string, valueUtf8: string | null, valueByteLength: number }) => ({ keyBase64: entry.keyBase64, keyUtf8: entry.keyUtf8, keyHex: entry.keyHex, serializedJson: entry.valueUtf8 === null ? null : JSON.parse(entry.valueUtf8), valueByteLength: entry.valueByteLength });
      return { roots: (await rootStore.debugEntries?.() ?? []).map(mapEntry), heap: (await heapDump.debugEntries?.() ?? []).map(mapEntry) };
    },
    debugLowLevelSnapshot: async () => await lowLevelDb.debugSnapshot?.() ?? { stores: {}, dumps: {} },
    initialSeq: lowLevelDb.initialSeq,
  };
}
