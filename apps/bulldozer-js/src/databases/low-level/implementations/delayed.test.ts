import { describe, expect, it } from "vitest";
import { declareDelayedLowLevelDatabase } from "./delayed.js";
import { declareInMemoryLowLevelDatabase } from "./in-memory.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const buffer = (value: string) => textEncoder.encode(value).buffer;
const text = (value: ArrayBuffer | null) => value === null ? null : textDecoder.decode(value);

function createDelayedDatabase(options: { readDelayMs: number, writeDelayMs: number }) {
  return declareDelayedLowLevelDatabase(declareInMemoryLowLevelDatabase(crypto.randomUUID()), options);
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
