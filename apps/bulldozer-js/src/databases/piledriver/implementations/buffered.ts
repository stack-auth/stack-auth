import { captureError } from "@hexclave/shared/dist/utils/errors";
import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { DatabaseSeq } from "../../index.js";
import { PiledriverDatabase, PiledriverObject } from "../index.js";

type PendingEntry = {
  id: string,
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
  if (!Number.isFinite(throttleMs) || throttleMs < 0 || throttleMs > 2 ** 31 - 1) {
    throw new Error("throttleMs must be a non-negative finite number no greater than 2^31 - 1");
  }

  const dbId = `buffered-piledriver-${crypto.randomUUID()}`;
  const initialSeq = [dbId, "initial"] as unknown as DatabaseSeq;
  const seqRecords = new WeakMap<object, SeqRecord>();
  const pending = new Map<string, PendingEntry>();
  const inFlight = new Map<string, PendingEntry>();
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
    for (const entry of batch) inFlight.set(entry.id, entry);
    flushPromise = (async () => {
      let combinedSeq = wrapped.initialSeq;
      try {
        for (const entry of batch) {
          const result = entry.state.type === "delete"
            ? await wrapped.deleteRootObject(entry.key)
            : await wrapped.setRootObject(entry.key, entry.state.value);
          combinedSeq = wrapped.combineSeqs(combinedSeq, result.seq);
          if (inFlight.get(entry.id) === entry && !pending.has(entry.id)) inFlight.delete(entry.id);
        }
        for (const entry of batch) for (const record of entry.records) record.resolve(combinedSeq);
        return combinedSeq;
      } catch (error) {
        // The caller was already told this write succeeded, so rolling back a failed flush could expose stale data
        // without anyone noticing; keep the failed value visible and report the anomaly instead.
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
    // This timer carries accepted writes toward durability, so it must keep the process alive until it fires.
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
    // Background flush failures are already reported through captureError, and real awaiters still observe the rejection.
    // This handler only prevents an unobserved record rejection from becoming an unhandled process rejection.
    record.flush.catch(() => undefined);
    seqRecords.set(seq, record);
    return { seq, record };
  };

  const createResolvedSeq = (underlyingSeq: DatabaseSeq) => {
    const { seq, record } = createSeq();
    record.resolve(underlyingSeq);
    return seq;
  };

  const write = (key: ArrayBuffer, state: PendingEntry["state"]) => {
    if (isClosing) throw new Error("Buffered Piledriver database is closing and cannot accept writes");
    const pendingKey = getPendingKey(key);
    const entry = pending.get(pendingKey.id) ?? {
      id: pendingKey.id,
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
    const memberRecords = seqs.map(memberSeq => ({
      memberSeq,
      record: getRecord(memberSeq),
    }));
    if (memberRecords.length === 1) return memberRecords[0].memberSeq;
    const { seq, record } = createSeq();
    runAsynchronously(async () => {
      const underlyingSeqs = await Promise.all(memberRecords.map(({ record: memberRecord }) => {
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
      return { backend: "piledriver-buffered", wrapped, pendingBufferSize: pending.size, inFlightBufferSize: inFlight.size };
    },
    async getRootObject(key) {
      const pendingKey = getPendingKey(key);
      const entry = pending.get(pendingKey.id) ?? inFlight.get(pendingKey.id);
      if (entry !== undefined) {
        if (entry.state.type === "delete") throw new Error("Root object not found");
        // Pending reads return the original object without serialization, so callers must preserve the same immutability
        // expectations as with the in-memory Piledriver backend.
        return { object: entry.state.value, seq: entry.latestSeq };
      }
      const result = await wrapped.getRootObject(key);
      return { object: result.object, seq: createResolvedSeq(result.seq) };
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
