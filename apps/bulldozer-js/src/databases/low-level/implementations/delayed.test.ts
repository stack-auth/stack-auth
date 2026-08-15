import { describe, expect, it } from "vitest";
import { LowLevelDatabase } from "../index.js";
import { declareDelayedLowLevelDatabase } from "./delayed.js";
import { declareInMemoryLowLevelDatabase } from "./in-memory.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const buffer = (value: string) => textEncoder.encode(value).buffer;
const text = (value: ArrayBuffer | null) => value === null ? null : textDecoder.decode(value);

function createDelayedDatabase(options: { readDelayMs: number, writeDelayMs: number }) {
  return declareDelayedLowLevelDatabase(declareInMemoryLowLevelDatabase(crypto.randomUUID()), options);
}

// An in-memory database whose very first `setAll` rejects, to check that a failed write doesn't take
// the emulated write device down with it.
function createFailingFirstWriteDatabase(): LowLevelDatabase {
  const inner = declareInMemoryLowLevelDatabase(crypto.randomUUID());
  let shouldFail = true;
  return {
    ...inner,
    declareKvStore(id) {
      const store = inner.declareKvStore(id);
      return {
        ...store,
        async setAll(entries, options) {
          if (shouldFail) {
            shouldFail = false;
            throw new Error("simulated write failure");
          }
          return await store.setAll(entries, options);
        },
      };
    },
  };
}

// Tracks how many wrapped `setAll` calls are ever in flight at the same time; the yield in the
// middle gives an unserialized wrapper every chance to overlap them.
function createConcurrencyTrackingDatabase(): { database: LowLevelDatabase, getMaxConcurrentWrites: () => number } {
  const inner = declareInMemoryLowLevelDatabase(crypto.randomUUID());
  let concurrentWrites = 0;
  let maxConcurrentWrites = 0;
  return {
    getMaxConcurrentWrites: () => maxConcurrentWrites,
    database: {
      ...inner,
      declareKvStore(id) {
        const store = inner.declareKvStore(id);
        return {
          ...store,
          async setAll(entries, options) {
            concurrentWrites++;
            maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
            await new Promise<void>(resolve => setImmediate(resolve));
            try {
              return await store.setAll(entries, options);
            } finally {
              concurrentWrites--;
            }
          },
        };
      },
    },
  };
}

// Records whether `close()` was reached while a mutation the wrapper had accepted had not reached the
// wrapped database yet, which is what a wrapper that closes without draining its in-flight work does.
function createCloseOrderTrackingDatabase(): { database: LowLevelDatabase, wasClosedBeforeMutationFinished: () => boolean } {
  const inner = declareInMemoryLowLevelDatabase(crypto.randomUUID());
  let finishedMutations = 0;
  let closedAfterMutations = 0;
  return {
    wasClosedBeforeMutationFinished: () => closedAfterMutations < finishedMutations,
    database: {
      ...inner,
      declareKvStore(id) {
        const store = inner.declareKvStore(id);
        return {
          ...store,
          async setAll(entries, options) {
            await new Promise<void>(resolve => setImmediate(resolve));
            const result = await store.setAll(entries, options);
            finishedMutations++;
            return result;
          },
          async compareAndSetAll(entries, options) {
            await new Promise<void>(resolve => setImmediate(resolve));
            const result = await store.compareAndSetAll(entries, options);
            finishedMutations++;
            return result;
          },
        };
      },
      async close() {
        closedAfterMutations = finishedMutations;
        await inner.close();
      },
    },
  };
}

describe("delayed low-level database", () => {
  it("rejects invalid delays", () => {
    const inMemory = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    expect(() => declareDelayedLowLevelDatabase(inMemory, { readDelayMs: -1, writeDelayMs: 0 })).toThrow("readDelayMs must be a non-negative finite number");
    expect(() => declareDelayedLowLevelDatabase(inMemory, { readDelayMs: 0, writeDelayMs: Number.POSITIVE_INFINITY })).toThrow("writeDelayMs must be a non-negative finite number");
  });

  it("behaves like the wrapped database", async () => {
    const database = createDelayedDatabase({ readDelayMs: 0, writeDelayMs: 0 });
    const store = database.declareKvStore("store");

    expect(text((await store.get(buffer("a"))).buffer)).toBe(null);
    await store.setAll([{ key: buffer("a"), value: buffer("1") }, { key: buffer("b"), value: buffer("2") }]);
    expect(text((await store.get(buffer("a"))).buffer)).toBe("1");

    const listed = await store.listEntries();
    expect(listed.entries.map(entry => [text(entry.key), text(entry.value)])).toEqual([["a", "1"], ["b", "2"]]);
    expect(listed.hasMore).toBe(false);

    const compareAndSet = await store.compareAndSetAll([
      { key: buffer("a"), compare: buffer("1"), value: buffer("3") },
      { key: buffer("b"), compare: buffer("wrong"), value: buffer("4") },
    ]);
    expect(compareAndSet.results.map(result => result.wasSet)).toEqual([true, false]);
    expect(text((await store.get(buffer("a"))).buffer)).toBe("3");
    expect(text((await store.get(buffer("b"))).buffer)).toBe("2");

    await store.deleteAll([buffer("a")]);
    expect(text((await store.get(buffer("a"))).buffer)).toBe(null);

    const dump = database.declareKvDump("dump");
    const inserted = await dump.insertAll([buffer("x")], { requiresSeq: database.initialSeq });
    expect(inserted.keys).toHaveLength(1);
    expect(text((await dump.get(inserted.keys[0])).buffer)).toBe("x");
  });

  it("delays every read by at least the read delay, in parallel", async () => {
    const readDelayMs = 20;
    const database = createDelayedDatabase({ readDelayMs, writeDelayMs: 0 });
    const store = database.declareKvStore("store");
    await store.setAll([{ key: buffer("a"), value: buffer("1") }]);

    const beforeSingleMs = performance.now();
    await store.get(buffer("a"));
    expect(performance.now() - beforeSingleMs).toBeGreaterThanOrEqual(readDelayMs);

    const beforeListMs = performance.now();
    await store.listEntries();
    expect(performance.now() - beforeListMs).toBeGreaterThanOrEqual(readDelayMs);

    // Reads are independent, so eight concurrent ones should still cost roughly one delay rather
    // than eight of them.
    const beforeConcurrentMs = performance.now();
    await Promise.all(Array.from({ length: 8 }, async () => await store.get(buffer("a"))));
    const concurrentElapsedMs = performance.now() - beforeConcurrentMs;
    expect(concurrentElapsedMs).toBeGreaterThanOrEqual(readDelayMs);
    expect(concurrentElapsedMs).toBeLessThan(readDelayMs * 4);
  });

  it("serializes writes through the emulated single-writer device", async () => {
    const writeDelayMs = 10;
    const writeCount = 5;
    const database = createDelayedDatabase({ readDelayMs: 0, writeDelayMs });
    const store = database.declareKvStore("store");

    const beforeMs = performance.now();
    await Promise.all(Array.from({ length: writeCount }, async (_, index) => await store.setAll([{ key: buffer(`k${index}`), value: buffer(`v${index}`) }])));
    expect(performance.now() - beforeMs).toBeGreaterThanOrEqual(writeDelayMs * writeCount);

    const listed = await store.listEntries();
    expect(listed.entries).toHaveLength(writeCount);
  });

  it("runs the wrapped write itself inside its writer slot", async () => {
    const { database: wrapped, getMaxConcurrentWrites } = createConcurrencyTrackingDatabase();
    const database = declareDelayedLowLevelDatabase(wrapped, { readDelayMs: 0, writeDelayMs: 5 });
    const store = database.declareKvStore("store");

    await Promise.all(Array.from({ length: 5 }, async (_, index) => await store.setAll([{ key: buffer(`k${index}`), value: buffer(`v${index}`) }])));
    expect(getMaxConcurrentWrites()).toBe(1);
  });

  it("makes compare-and-set pay the write delay only when it writes", async () => {
    const readDelayMs = 10;
    // Deliberately far apart: the "didn't write, so didn't pay the service time" assertion compares
    // against this bound, and a tight one would fail whenever CI stalls the event loop for a few ms.
    const writeDelayMs = 200;
    const database = createDelayedDatabase({ readDelayMs, writeDelayMs });
    const store = database.declareKvStore("store");
    await store.setAll([{ key: buffer("a"), value: buffer("1") }]);
    const afterSetup = database.getDebugInfo();

    const beforeFailedMs = performance.now();
    const failed = await store.compareAndSetAll([{ key: buffer("a"), compare: buffer("wrong"), value: buffer("2") }]);
    const failedElapsedMs = performance.now() - beforeFailedMs;
    expect(failed.results.map(result => result.wasSet)).toEqual([false]);
    expect(failedElapsedMs).toBeGreaterThanOrEqual(readDelayMs);
    expect(failedElapsedMs).toBeLessThan(writeDelayMs);
    const afterFailed = database.getDebugInfo();
    expect(afterFailed.readOperations).toBe(afterSetup.readOperations + 1);
    expect(afterFailed.writeOperations).toBe(afterSetup.writeOperations);

    const beforeSucceededMs = performance.now();
    const succeeded = await store.compareAndSetAll([{ key: buffer("a"), compare: buffer("1"), value: buffer("2") }]);
    expect(succeeded.results.map(result => result.wasSet)).toEqual([true]);
    expect(performance.now() - beforeSucceededMs).toBeGreaterThanOrEqual(readDelayMs + writeDelayMs);
    const afterSucceeded = database.getDebugInfo();
    expect(afterSucceeded.readOperations).toBe(afterFailed.readOperations + 1);
    expect(afterSucceeded.writeOperations).toBe(afterFailed.writeOperations + 1);
    expect(text((await store.get(buffer("a"))).buffer)).toBe("2");
  });

  it("keeps the writer usable after a write fails", async () => {
    const writeDelayMs = 50;
    const database = declareDelayedLowLevelDatabase(createFailingFirstWriteDatabase(), { readDelayMs: 0, writeDelayMs });
    const store = database.declareKvStore("store");

    // Both writes are queued before either is awaited, so the timing covers the failed write's own
    // slot: a regression that paid the service delay before rejecting would push the second write
    // past two intervals instead of one. The failed write must also neither leave the emulated device
    // permanently occupied nor count as a write that happened.
    const beforeMs = performance.now();
    const failedWrite = store.setAll([{ key: buffer("a"), value: buffer("1") }]);
    const succeedingWrite = store.setAll([{ key: buffer("b"), value: buffer("2") }]);
    await expect(failedWrite).rejects.toThrow("simulated write failure");
    await succeedingWrite;
    const elapsedMs = performance.now() - beforeMs;
    expect(elapsedMs).toBeGreaterThanOrEqual(writeDelayMs);
    expect(elapsedMs).toBeLessThan(writeDelayMs * 2);
    expect(database.getDebugInfo().writeOperations).toBe(1);
    expect(text((await store.get(buffer("b"))).buffer)).toBe("2");
  });

  it("waits for queued writes before closing the wrapped database", async () => {
    const writeDelayMs = 50;
    const { database: wrapped, wasClosedBeforeMutationFinished } = createCloseOrderTrackingDatabase();
    const database = declareDelayedLowLevelDatabase(wrapped, { readDelayMs: 0, writeDelayMs });
    const store = database.declareKvStore("store");

    const pendingWrite = store.setAll([{ key: buffer("a"), value: buffer("1") }]);
    const beforeCloseMs = performance.now();
    await database.close();
    expect(performance.now() - beforeCloseMs).toBeGreaterThanOrEqual(writeDelayMs);
    expect(wasClosedBeforeMutationFinished()).toBe(false);
    await pendingWrite;
  });

  it("waits for a compare-and-set that is still paying its read delay before closing", async () => {
    // A compare-and-set sleeps off its read delay before it ever reaches the writer queue, so it is
    // invisible to a `close()` that only drains that queue.
    const readDelayMs = 50;
    const { database: wrapped, wasClosedBeforeMutationFinished } = createCloseOrderTrackingDatabase();
    const database = declareDelayedLowLevelDatabase(wrapped, { readDelayMs, writeDelayMs: 10 });
    const store = database.declareKvStore("store");
    await store.setAll([{ key: buffer("a"), value: buffer("1") }]);

    const pendingCompareAndSet = store.compareAndSetAll([{ key: buffer("a"), compare: buffer("1"), value: buffer("2") }]);
    await database.close();
    // Awaited only after `close()` returned: the ordering question is whether the compare-and-set had
    // already reached the wrapped database by then, so it must be settled before asserting.
    expect((await pendingCompareAndSet).results.map(result => result.wasSet)).toEqual([true]);
    expect(wasClosedBeforeMutationFinished()).toBe(false);
  });

  it("reports delay counters in debug info", async () => {
    const database = createDelayedDatabase({ readDelayMs: 1, writeDelayMs: 1 });
    const store = database.declareKvStore("store");
    await store.setAll([{ key: buffer("a"), value: buffer("1") }]);
    await store.get(buffer("a"));

    const debugInfo = database.getDebugInfo();
    expect(debugInfo.backend).toBe("delayed");
    expect(debugInfo.readOperations).toBe(1);
    expect(debugInfo.writeOperations).toBe(1);
    expect(debugInfo.delayedReadMs).toBeGreaterThan(0);
    expect(debugInfo.delayedWriteMs).toBeGreaterThan(0);
  });
});
