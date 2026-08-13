import { captureError } from "@hexclave/shared/dist/utils/errors";
import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { DatabaseSeq } from "../../index.js";
import { PiledriverDatabase, PiledriverObject } from "../index.js";

type BufferedPiledriverSeq = DatabaseSeq;
type PendingEntry = {
  key: ArrayBuffer,
  value: PiledriverObject | undefined,
  deleted: boolean,
  records: SeqRecord[],
};
type SeqRecord = {
  flush: Promise<DatabaseSeq>,
  resolve: (seq: DatabaseSeq) => void,
  reject: (error: unknown) => void,
};

const cloneKey = (key: ArrayBuffer) => key.slice(0);
const pendingValue = (entry: PendingEntry): PiledriverObject => {
  if (entry.value === undefined) throw new Error("Buffered Piledriver pending value is missing");
  return entry.value;
};

export function declareBufferedPiledriverDatabase(
  wrapped: PiledriverDatabase,
  options: { throttleMs?: number } = {},
): PiledriverDatabase {
  const throttleMs = options.throttleMs ?? 200;
  if (!Number.isFinite(throttleMs) || throttleMs < 0) throw new Error("throttleMs must be a non-negative finite number");

  const dbId = `buffered-piledriver-${crypto.randomUUID()}`;
  const initialSeq = [dbId, "initial"] as unknown as BufferedPiledriverSeq;
  const seqRecords = new WeakMap<object, SeqRecord>();
  const pending = new Map<string, PendingEntry>();
  let flushPromise: Promise<DatabaseSeq> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = -Infinity;
  let closePromise: Promise<void> | null = null;
  let isClosing = false;

  const getRecord = (seq: DatabaseSeq) => {
    if (seq === initialSeq) return null;
    if (!Array.isArray(seq) || seq[0] !== dbId) throw new Error("Buffered Piledriver sequence does not belong to this database");
    const record = seqRecords.get(seq);
    if (record === undefined) throw new Error("Unknown buffered Piledriver sequence");
    return record;
  };

  const flushPending = (): Promise<DatabaseSeq> => {
    if (flushPromise !== null) return flushPromise;
    if (pending.size === 0) return Promise.resolve(initialSeq);

    const batch = [...pending.values()];
    pending.clear();
    flushPromise = (async () => {
      let combinedSeq = wrapped.initialSeq;
      try {
        for (const entry of batch) {
          const result = entry.deleted
            ? await wrapped.deleteRootObject(entry.key)
            : await wrapped.setRootObject(entry.key, pendingValue(entry));
          combinedSeq = wrapped.combineSeqs(combinedSeq, result.seq);
        }
        for (const entry of batch) for (const record of entry.records) record.resolve(combinedSeq);
        return combinedSeq;
      } catch (error) {
        for (const entry of batch) {
          const current = pending.get(encodeBase64(new Uint8Array(entry.key)));
          if (current === undefined) pending.set(encodeBase64(new Uint8Array(entry.key)), entry);
        }
        for (const entry of batch) for (const record of entry.records) record.reject(error);
        throw error;
      } finally {
        lastFlushAt = performance.now();
        flushPromise = null;
        if (pending.size > 0) scheduleFlush();
      }
    })();
    flushPromise.catch(error => captureError("bulldozer-js:piledriver-buffered-flush", error));
    return flushPromise;
  };

  const scheduleFlush = () => {
    if (flushPromise !== null || pending.size === 0 || flushTimer !== null) return;
    const delay = lastFlushAt === -Infinity ? 0 : Math.max(0, throttleMs - (performance.now() - lastFlushAt));
    if (delay === 0) {
      void Promise.resolve().then(() => flushPending().catch(() => {})).catch(() => {});
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPending().catch(() => {});
    }, delay);
    if ("unref" in flushTimer) flushTimer.unref();
  };

  const flushImmediately = async () => {
    while (pending.size > 0 || flushPromise !== null) {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (flushPromise !== null) await flushPromise;
      else await flushPending();
    }
  };

  const createSeq = (entry: PendingEntry) => {
    const seq = [dbId, crypto.randomUUID()] as unknown as BufferedPiledriverSeq;
    let resolve!: (value: DatabaseSeq) => void;
    let reject!: (error: unknown) => void;
    const flush = new Promise<DatabaseSeq>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const record = { flush, resolve, reject };
    entry.records.push(record);
    seqRecords.set(seq, record);
    return seq;
  };

  const keyString = (key: ArrayBuffer) => encodeBase64(new Uint8Array(key));
  const write = (key: ArrayBuffer, value: PiledriverObject | undefined, deleted: boolean) => {
    if (isClosing) throw new Error("Buffered Piledriver database is closing and cannot accept writes");
    const keyCopy = cloneKey(key);
    const stringKey = keyString(keyCopy);
    const entry = pending.get(stringKey) ?? { key: keyCopy, value, deleted, records: [] };
    entry.value = value;
    entry.deleted = deleted;
    pending.set(stringKey, entry);
    const seq = createSeq(entry);
    scheduleFlush();
    return seq;
  };

  const waitUntil = async (seq: DatabaseSeq, wait: (underlyingSeq: DatabaseSeq) => Promise<void>) => {
    const record = getRecord(seq);
    if (record === null) return await wait(wrapped.initialSeq);
    const underlyingSeq = await record.flush;
    await wait(underlyingSeq);
  };

  return {
    getDebugInfo() {
      return { backend: "piledriver-buffered", wrapped, pendingBufferSize: pending.size };
    },
    async getRootObject(key) {
      const entry = pending.get(keyString(key));
      if (entry !== undefined) {
        if (entry.deleted) throw new Error("Root object not found");
        return { object: pendingValue(entry), seq: initialSeq };
      }
      return await wrapped.getRootObject(key);
    },
    async setRootObject(key, value) {
      return { seq: write(key, value, false) };
    },
    async deleteRootObject(key) {
      return { seq: write(key, undefined, true) };
    },
    getGarbageCollectionProcessStartedAtMillis() {
      return wrapped.getGarbageCollectionProcessStartedAtMillis();
    },
    async collectGarbage(cutoffTimestampMillis, maxObjects) {
      await flushImmediately();
      return await wrapped.collectGarbage(cutoffTimestampMillis, maxObjects);
    },
    async debugSnapshot() {
      await flushImmediately();
      if (wrapped.debugSnapshot === undefined) return { roots: [], heap: [] };
      return await wrapped.debugSnapshot();
    },
    async debugLowLevelSnapshot() {
      await flushImmediately();
      if (wrapped.debugLowLevelSnapshot === undefined) return { stores: {}, dumps: {} };
      return await wrapped.debugLowLevelSnapshot();
    },
    combineSeqs(...seqs) {
      return seqs.length === 0 ? initialSeq : seqs[seqs.length - 1];
    },
    waitUntilAvailable: async () => {},
    waitUntilDurable: async seq => await waitUntil(seq, underlyingSeq => wrapped.waitUntilDurable(underlyingSeq)),
    waitUntilReplicated: async seq => await waitUntil(seq, underlyingSeq => wrapped.waitUntilReplicated(underlyingSeq)),
    async close() {
      if (closePromise === null) {
        isClosing = true;
        closePromise = (async () => {
          try {
            await flushImmediately();
          } finally {
            await wrapped.close();
          }
        })();
      }
      await closePromise;
    },
    initialSeq,
  };
}
