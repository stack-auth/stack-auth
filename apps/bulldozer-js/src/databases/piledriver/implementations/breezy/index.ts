import { DatabaseSeq } from "../../../index.js";
import { LowLevelDatabase } from "../../../low-level/index.js";
import { declarePiledriverGarbageCollector } from "../../gc.js";
import { heapObjectsByObject, PiledriverDatabase, PiledriverObject } from "../../index.js";
import { decodePiledriverObject, encodePiledriverObject, PlannedPiledriverObject } from "./codec.js";
import { createPiledriverHeapCache } from "./heap-cache.js";
import { planHeapObjects } from "./heap-plan.js";

const breezyPiledriverProcessStartedAtMillis = Date.now();

export type BreezyPiledriverDatabaseOptions = { disableHeapReadCache?: boolean, garbageCollectionProcessStartedAtMillis?: number };

export function declareBreezyPiledriverDatabase(lowLevelDb: LowLevelDatabase, options: BreezyPiledriverDatabaseOptions = {}): PiledriverDatabase {
  const processStartedAtMillis = options.garbageCollectionProcessStartedAtMillis ?? breezyPiledriverProcessStartedAtMillis;
  if (!Number.isSafeInteger(processStartedAtMillis) || processStartedAtMillis < 0) throw new Error("Piledriver garbageCollectionProcessStartedAtMillis must be a non-negative safe integer");

  const rootStore = lowLevelDb.declareKvStore("root");
  const heapDump = lowLevelDb.declareKvDump("heap");
  const garbageCollector = declarePiledriverGarbageCollector({
    lowLevelDb,
    heapDump,
    processStartedAtMillis,
    missingMetadataBehavior: "initialize-on-positive-reference",
  });
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

  const serializeKnown = (value: PlannedPiledriverObject) => encodePiledriverObject(value);

  /**
   * Plans the complete graph, then publishes each newly created heap object in order.
   *
   * Planning replaces heap objects with key-only references, so serialization performs no cache
   * lookups or IO. A crash before the root is published may leak the unreachable subgraph; that
   * deliberate tradeoff keeps the normal publication path small and fast.
   */
  const serializeAndPublish = async (value: PiledriverObject) => {
    const plan = planHeapObjects(
      value,
      object => {
        const location = heapCache.getLocation(object);
        return location === undefined ? undefined : { key: location.key, dependency: location.seq };
      },
      () => heapDump.reserveKeys(1)[0],
    );
    const publicationSeqs = [...plan.dependencies];
    for (const item of plan.heapObjects) {
      const buffer = serializeKnown(item.value);
      const inserted = await heapDump.insertAll([buffer], { keys: [item.key] });
      const references = await garbageCollector.beforeSerializedHeapObjectsBecomeVisible(
        [buffer],
        lowLevelDb.initialSeq,
      );
      publicationSeqs.push(inserted.seq, references.seq);
    }

    const publishedSeq = combineSeqs(publicationSeqs);
    for (const item of plan.heapObjects) {
      heapCache.remember(item.object, { key: item.key, seq: publishedSeq });
    }
    return { buffer: serializeKnown(plan.root), seq: publishedSeq };
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
