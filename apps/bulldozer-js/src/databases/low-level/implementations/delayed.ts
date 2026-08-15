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
  // The emulated write device's timeline: the point (on the `performance.now` clock) at which it
  // finishes everything queued so far. A new write starts once the device is free, so queueing delay
  // falls out of the model instead of having to be simulated separately.
  let writeDeviceFreeAtMs = 0;

  const withReadDelay = async <T>(operation: () => Promise<T>): Promise<T> => {
    const deadlineMs = performance.now() + readDelayMs;
    const result = await operation();
    readOperations++;
    const beforeSleepMs = performance.now();
    await sleepUntil(deadlineMs);
    delayedReadMs += performance.now() - beforeSleepMs;
    return result;
  };

  const withWriteDelay = async <T>(operation: () => Promise<T>): Promise<T> => {
    const startMs = Math.max(performance.now(), writeDeviceFreeAtMs);
    writeDeviceFreeAtMs = startMs + writeDelayMs;
    const deadlineMs = writeDeviceFreeAtMs;
    const result = await operation();
    writeOperations++;
    const beforeSleepMs = performance.now();
    await sleepUntil(deadlineMs);
    delayedWriteMs += performance.now() - beforeSleepMs;
    return result;
  };

  const declareStoreOrDump = (wrappedStore: LowLevelKvStore & LowLevelKvDump): LowLevelKvStore & LowLevelKvDump => ({
    async get(key) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.get", attributes }, async () => await withReadDelay(async () => await wrappedStore.get(key)));
    },
    async listEntries(listOptions) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.listEntries", attributes }, async () => await withReadDelay(async () => await wrappedStore.listEntries(listOptions)));
    },
    async setAll(entries, setOptions) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.setAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => await withWriteDelay(async () => await wrappedStore.setAll(entries, setOptions)));
    },
    async deleteAll(keys, deleteOptions) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.deleteAll", attributes: { ...attributes, "bulldozer.low_level.key_count": keys.length } }, async () => await withWriteDelay(async () => await wrappedStore.deleteAll(keys, deleteOptions)));
    },
    async insertAll(values, insertOptions) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.insertAll", attributes: { ...attributes, "bulldozer.low_level.value_count": values.length } }, async () => await withWriteDelay(async () => await wrappedStore.insertAll(values, insertOptions)));
    },
    async compareAndSetAll(entries, compareAndSetOptions) {
      return await traceSpanHot({ description: "bulldozer-js.low-level.delayed.compareAndSetAll", attributes: { ...attributes, "bulldozer.low_level.entry_count": entries.length } }, async () => {
        // A compare-and-set reads the current values and then writes the matching ones, so it pays
        // both delays rather than being classified as one or the other.
        const result = await withReadDelay(async () => await wrappedStore.compareAndSetAll(entries, compareAndSetOptions));
        if (result.results.some(entryResult => entryResult.wasSet)) await withWriteDelay(async () => {});
        return result;
      });
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
    declareKvStore(id) {
      return declareStoreOrDump(wrapped.declareKvStore(id) as LowLevelKvStore & LowLevelKvDump);
    },
    declareKvDump(id) {
      return declareStoreOrDump(wrapped.declareKvDump(id) as LowLevelKvStore & LowLevelKvDump);
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
      await wrapped.close();
    },
    async debugSnapshot() {
      return await wrapped.debugSnapshot?.() ?? { stores: {}, dumps: {} };
    },
    initialSeq: wrapped.initialSeq,
  };
}
