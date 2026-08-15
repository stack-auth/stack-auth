import { traceSpanHot } from "../../../otel.js";
import { DatabaseSeq } from "../../index.js";
import { LowLevelDatabase, LowLevelKvDump, LowLevelKvStore } from "../index.js";

/**
 * Emulates the IO cost of a real storage engine on top of a backend that has none (in practice the
 * in-memory one). This exists for benchmarks that want to split "how much of a flow's cost is the
 * amount of IO Piledriver issues" from "how much is everything else", which the in-memory backend
 * alone cannot answer because it makes IO free.
 *
 * The two delays model the two shapes LMDB's IO has:
 *  - reads are memory-mapped and independent, so `readDelayMs` is a plain per-operation latency and
 *    concurrent reads all pay it in parallel;
 *  - writes go through a single writer, so `writeDelayMs` is the service time of one emulated device
 *    that serializes: a burst of N writes takes N * writeDelayMs, exactly like a queue in front of a
 *    real commit path, rather than N writes each finishing after writeDelayMs.
 */
export type DelayedLowLevelDatabaseOptions = {
  readDelayMs: number,
  writeDelayMs: number,
};

// setTimeout only has millisecond resolution, but the interesting delays here are tens of
// microseconds. Sleep the whole-millisecond part on a timer and yield through the macrotask queue
// for the remainder: that keeps the event loop free (unlike a busy-wait) while still landing within
// a few tens of microseconds of the deadline.
async function sleepUntil(deadlineMs: number): Promise<void> {
  while (true) {
    const remainingMs = deadlineMs - performance.now();
    if (remainingMs <= 0) return;
    if (remainingMs >= 2) {
      await new Promise<void>(resolve => setTimeout(resolve, remainingMs - 1));
    } else {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}

export function declareDelayedLowLevelDatabase(wrapped: LowLevelDatabase, options: DelayedLowLevelDatabaseOptions): LowLevelDatabase {
  const { readDelayMs, writeDelayMs } = options;
  if (!Number.isFinite(readDelayMs) || readDelayMs < 0) throw new Error("readDelayMs must be a non-negative finite number");
  if (!Number.isFinite(writeDelayMs) || writeDelayMs < 0) throw new Error("writeDelayMs must be a non-negative finite number");

  const attributes = { "bulldozer.low_level.backend": "delayed" };
  let readOperations = 0;
  let writeOperations = 0;
  let delayedReadMs = 0;
  let delayedWriteMs = 0;
  // Tail of the emulated write device's queue: a promise that settles once everything currently
  // queued has been serviced. Each write chains onto it, which is what makes writes actually run
  // one at a time (as opposed to only their completion times being staggered) and gives `close()`
  // something to await. The chained promise is always resolved, never rejected, so a failing write
  // does not poison the queue for the writes behind it.
  let writerQueueTail: Promise<void> = Promise.resolve();

  const payReadDelay = async (deadlineMs: number): Promise<void> => {
    readOperations++;
    const beforeSleepMs = performance.now();
    await sleepUntil(deadlineMs);
    delayedReadMs += performance.now() - beforeSleepMs;
  };

  const withReadDelay = async <T>(operation: () => Promise<T>): Promise<T> => {
    const deadlineMs = performance.now() + readDelayMs;
    const result = await operation();
    await payReadDelay(deadlineMs);
    return result;
  };

  /**
   * Runs `operation` in its own slot on the emulated single writer: nothing else in this wrapper
   * writes while it runs, and the slot is only released once the device's service time has elapsed.
   * `shouldPayWriteDelay` lets compare-and-set skip the service time when it didn't actually write.
   */
  const withWriteDelay = async <T>(operation: () => Promise<T>, shouldPayWriteDelay: (result: T) => boolean = () => true): Promise<T> => {
    const previousQueueTail = writerQueueTail;
    let releaseNextWrite = (): void => {};
    writerQueueTail = new Promise<void>(resolve => {
      releaseNextWrite = resolve;
    });
    await previousQueueTail;
    try {
      const deadlineMs = performance.now() + writeDelayMs;
      const result = await operation();
      if (!shouldPayWriteDelay(result)) return result;
      writeOperations++;
      const beforeSleepMs = performance.now();
      await sleepUntil(deadlineMs);
      delayedWriteMs += performance.now() - beforeSleepMs;
      return result;
    } finally {
      releaseNextWrite();
    }
  };

  // The methods a KV store and a KV dump have in common; the two differ only in how they write
  // (`setAll`/`compareAndSetAll` vs. `insertAll`), which is why those are added by the callers below.
  const declareSharedMethods = (wrappedStore: LowLevelKvStore | LowLevelKvDump) => ({
    async get(key: ArrayBuffer) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.get", attributes }, async () => await withReadDelay(async () => await wrappedStore.get(key)));
    },
    async listEntries(listOptions?: { startAfter?: ArrayBuffer, limit?: number }) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.listEntries", attributes }, async () => await withReadDelay(async () => await wrappedStore.listEntries(listOptions)));
    },
    async deleteAll(keys: ArrayBuffer[], deleteOptions?: { requiresSeq?: DatabaseSeq }) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.deleteAll", attributes: { ...attributes, "bulldozer.low_level.key_count": keys.length } }, async () => await withWriteDelay(async () => await wrappedStore.deleteAll(keys, deleteOptions)));
    },
    async debugEntries() {
      return await wrappedStore.debugEntries?.() ?? [];
    },
  });

  return {
    getDebugInfo() {
      return {
        backend: "delayed",
        constructorArguments: { wrapped, options },
        wrapped,
        readDelayMs,
        writeDelayMs,
        readOperations,
        writeOperations,
        delayedReadMs,
        delayedWriteMs,
      };
    },
    declareKvStore(id): LowLevelKvStore {
      const wrappedStore = wrapped.declareKvStore(id);
      return {
        ...declareSharedMethods(wrappedStore),
        async setAll(entries, setOptions) {
          return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.setAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => await withWriteDelay(async () => await wrappedStore.setAll(entries, setOptions)));
        },
        async compareAndSetAll(entries, compareAndSetOptions) {
          return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.compareAndSetAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => {
            // A compare-and-set first reads the current values (always) and then writes the matching
            // ones (only if any matched), so it pays the read latency up front and the writer's
            // service time only when it actually mutated something.
            await payReadDelay(performance.now() + readDelayMs);
            return await withWriteDelay(
              async () => await wrappedStore.compareAndSetAll(entries, compareAndSetOptions),
              result => result.results.some(entryResult => entryResult.wasSet),
            );
          });
        },
      };
    },
    declareKvDump(id): LowLevelKvDump {
      const wrappedDump = wrapped.declareKvDump(id);
      return {
        ...declareSharedMethods(wrappedDump),
        async insertAll(values, insertOptions) {
          return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.insertAll", attributes: { ...attributes, "bulldozer.low_level.value_count": values.length } }, async () => await withWriteDelay(async () => await wrappedDump.insertAll(values, insertOptions)));
        },
      };
    },
    async waitUntilAvailable(seq: DatabaseSeq) {
      await wrapped.waitUntilAvailable(seq);
    },
    async waitUntilDurable(seq: DatabaseSeq) {
      await wrapped.waitUntilDurable(seq);
    },
    async waitUntilReplicated(seq: DatabaseSeq) {
      await wrapped.waitUntilReplicated(seq);
    },
    combineSeqs(...seqs) {
      return wrapped.combineSeqs(...seqs);
    },
    async close() {
      // Writes that are still queued behind the emulated device would otherwise run against an
      // already-closed backend.
      await writerQueueTail;
      await wrapped.close();
    },
    async debugSnapshot() {
      return await wrapped.debugSnapshot?.() ?? { stores: {}, dumps: {} };
    },
    initialSeq: wrapped.initialSeq,
  };
}
