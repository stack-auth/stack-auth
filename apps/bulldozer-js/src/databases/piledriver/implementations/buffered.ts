import { captureError } from "@hexclave/shared/dist/utils/errors";
import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { DatabaseSeq } from "../../index.js";
import { PiledriverDatabase, PiledriverObject } from "../index.js";

type PendingEntry = {
  key: ArrayBuffer,
  state: { type: "set", value: PiledriverObject } | { type: "delete" },
  latestSeq: DatabaseSeq,
  records: SeqRecord[],
};
type SeqRecord = {
  flush: Promise<DatabaseSeq>,
  resolve: (seq: DatabaseSeq) => void,
  reject: (error: unknown) => void,
};

const getPendingKey = (key: ArrayBuffer) => ({
  id: encodeBase64(new Uint8Array(key)),
  key: key.slice(0),
});

export function declareBufferedPiledriverDatabase(
  wrapped: PiledriverDatabase,
  options: { throttleMs?: number } = {},
): PiledriverDatabase {
  const throttleMs = options.throttleMs ?? 200;
  if (!Number.isFinite(throttleMs) || throttleMs < 0) throw new Error("throttleMs must be a non-negative finite number");

  const dbId = `buffered-piledriver-${crypto.randomUUID()}`;
  const initialSeq = [dbId, "initial"] as unknown as DatabaseSeq;
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
    if (pending.size === 0) return Promise.resolve(wrapped.initialSeq);

    const batch = [...pending.values()];
    pending.clear();
    flushPromise = (async () => {
      let combinedSeq = wrapped.initialSeq;
      try {
        for (const entry of batch) {
          const result = entry.state.type === "delete"
            ? await wrapped.deleteRootObject(entry.key)
            : await wrapped.setRootObject(entry.key, entry.state.value);
          combinedSeq = wrapped.combineSeqs(combinedSeq, result.seq);
        }
        for (const entry of batch) for (const record of entry.records) record.resolve(combinedSeq);
        return combinedSeq;
      } catch (error) {
        // The caller was already told this write succeeded, so swallowing a background failure could lose data without
        // anyone noticing.
        for (const entry of batch) for (const record of entry.records) record.reject(error);
        throw error;
      } finally {
        lastFlushAt = performance.now();
        flushPromise = null;
        if (pending.size > 0) scheduleFlush();
      }
    })();
    return flushPromise;
  };

  const startBackgroundFlush = () => runAsynchronously(flushPending(), {
    noErrorLogging: true,
    onError: error => captureError("bulldozer-js:piledriver-buffered-flush", error),
  });

  const scheduleFlush = () => {
    if (flushPromise !== null || pending.size === 0 || flushTimer !== null) return;
    const delay = lastFlushAt === -Infinity ? 0 : Math.max(0, throttleMs - (performance.now() - lastFlushAt));
    if (delay === 0) {
      queueMicrotask(startBackgroundFlush);
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      startBackgroundFlush();
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

  const createSeq = () => {
    const seq = [dbId, crypto.randomUUID()] as unknown as DatabaseSeq;
    let resolve!: (value: DatabaseSeq) => void;
    let reject!: (error: unknown) => void;
    const flush = new Promise<DatabaseSeq>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const record = { flush, resolve, reject };
    seqRecords.set(seq, record);
    return { seq, record };
  };

  const write = (key: ArrayBuffer, state: PendingEntry["state"]) => {
    if (isClosing) throw new Error("Buffered Piledriver database is closing and cannot accept writes");
    const pendingKey = getPendingKey(key);
    const entry = pending.get(pendingKey.id) ?? {
      key: pendingKey.key,
      state,
      latestSeq: initialSeq,
      records: [],
    };
    const { seq, record } = createSeq();
    entry.state = state;
    entry.latestSeq = seq;
    entry.records.push(record);
    pending.set(pendingKey.id, entry);
    scheduleFlush();
    return seq;
  };

  const createCombinedSeq = (seqs: DatabaseSeq[]) => {
    if (seqs.length === 0) return initialSeq;
    const { seq, record } = createSeq();
    runAsynchronously(async () => {
      const underlyingSeqs = await Promise.all(seqs.map(memberSeq => {
        const memberRecord = getRecord(memberSeq);
        return memberRecord === null ? Promise.resolve(wrapped.initialSeq) : memberRecord.flush;
      }));
      record.resolve(wrapped.combineSeqs(...underlyingSeqs));
    }, {
      noErrorLogging: true,
      onError: error => record.reject(error),
    });
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
      const entry = pending.get(getPendingKey(key).id);
      if (entry !== undefined) {
        if (entry.state.type === "delete") throw new Error("Root object not found");
        // Pending reads return the original object without serialization, so callers must preserve the same immutability
        // expectations as with the in-memory Piledriver backend.
        return { object: entry.state.value, seq: entry.latestSeq };
      }
      return await wrapped.getRootObject(key);
    },
    async setRootObject(key, value) {
      return { seq: write(key, { type: "set", value }) };
    },
    async deleteRootObject(key) {
      return { seq: write(key, { type: "delete" }) };
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
      return createCombinedSeq(seqs);
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
