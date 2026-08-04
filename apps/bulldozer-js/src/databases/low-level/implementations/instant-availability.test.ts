import { describe, expect, it } from "vitest";
import { DatabaseSeq } from "../../index.js";
import { LowLevelDatabase, LowLevelKvStore } from "../index.js";
import { declareInstantAvailabilityLowLevelDatabase } from "./instant-availability.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const buffer = (value: string) => textEncoder.encode(value).buffer;
const text = (value: ArrayBuffer | null) => value === null ? null : textDecoder.decode(value);

function createSlowSetDatabase() {
  const releaseSets: Array<() => void> = [];
  let setCallCount = 0;
  let closeCallCount = 0;
  const committed = new Map<string, ArrayBuffer>();
  const initialSeq = ["slow", "initial"] as unknown as DatabaseSeq;
  const seqToPromise = new Map<DatabaseSeq, Promise<void>>([[initialSeq, Promise.resolve()]]);
  const store: LowLevelKvStore = {
    async get(key) {
      return { buffer: committed.get(text(key)!)?.slice(0) ?? null, seq: initialSeq };
    },
    async setAll(entries) {
      setCallCount++;
      const seq = ["slow", crypto.randomUUID()] as unknown as DatabaseSeq;
      const promise = new Promise<void>(resolve => {
        releaseSets.push(() => {
          for (const { key, value } of entries) committed.set(text(key)!, value.slice(0));
          resolve();
        });
      });
      seqToPromise.set(seq, promise);
      return { seq };
    },
    async deleteAll() {
      throw new Error("not implemented");
    },
    async compareAndSet() {
      throw new Error("not implemented");
    },
  };
  const db: LowLevelDatabase = {
    getDebugInfo() {
      return {
        backend: "slow-set-test",
        releaseSets,
        setCallCount,
        committed,
        seqToPromise,
        initialSeq,
      };
    },
    declareKvStore: () => store,
    declareKvDump: () => {
      throw new Error("not implemented");
    },
    async waitUntilAvailable(seq) {
      await seqToPromise.get(seq);
    },
    async waitUntilDurable(seq) {
      await seqToPromise.get(seq);
    },
    async waitUntilReplicated(seq) {
      await seqToPromise.get(seq);
    },
    combineSeqs(...seqs) {
      return seqs[seqs.length - 1] ?? initialSeq;
    },
    async close() {
      closeCallCount++;
      await Promise.all(seqToPromise.values());
    },
    initialSeq,
  };
  return {
    db,
    releaseSet: () => {
      const releaseSet = releaseSets.shift();
      if (releaseSet === undefined) throw new Error("set was not started");
      releaseSet();
    },
    setCallCount: () => setCallCount,
    closeCallCount: () => closeCallCount,
  };
}

describe("instant-availability low-level database", () => {
  it("serves pending writes from memory before the wrapped database is available", async () => {
    const slow = createSlowSetDatabase();
    const db = declareInstantAvailabilityLowLevelDatabase(slow.db, { dbId: "instant-test" });
    const store = db.declareKvStore("store");

    const { seq } = await store.setAll([{ key: buffer("key"), value: buffer("pending") }]);
    await db.waitUntilAvailable(seq);
    expect(text((await store.get(buffer("key"))).buffer)).toBe("pending");

    let replicated = false;
    const replicatedPromise = db.waitUntilReplicated(seq).then(() => {
      replicated = true;
    });
    await Promise.resolve();
    expect(replicated).toBe(false);

    slow.releaseSet();
    await replicatedPromise;
    expect(replicated).toBe(true);
  });

  it("applies backpressure to writes when too many seq records are pending", async () => {
    const slow = createSlowSetDatabase();
    const db = declareInstantAvailabilityLowLevelDatabase(slow.db, {
      dbId: "instant-test",
      maxPendingSeqRecords: 1,
    });
    const store = db.declareKvStore("store");

    await store.setAll([{ key: buffer("first"), value: buffer("pending") }]);
    await Promise.resolve();
    expect(slow.setCallCount()).toBe(1);

    let secondWriteFinished = false;
    const secondWrite = store.setAll([{ key: buffer("second"), value: buffer("blocked") }]).then(() => {
      secondWriteFinished = true;
    });
    await Promise.resolve();
    expect(slow.setCallCount()).toBe(1);
    expect(secondWriteFinished).toBe(false);

    slow.releaseSet();
    await secondWrite;
    expect(slow.setCallCount()).toBe(2);
    expect(secondWriteFinished).toBe(true);

    slow.releaseSet();
  });

  it("drains pending writes and closes the wrapped database exactly once", async () => {
    const slow = createSlowSetDatabase();
    const db = declareInstantAvailabilityLowLevelDatabase(slow.db, { dbId: "instant-close-test" });
    const store = db.declareKvStore("store");
    await store.setAll([{ key: buffer("key"), value: buffer("pending") }]);

    const closing = db.close();
    expect(await Promise.race([
      closing.then(() => "closed"),
      Promise.resolve("pending"),
    ])).toBe("pending");
    expect(slow.closeCallCount()).toBe(0);

    slow.releaseSet();
    await closing;
    expect(slow.closeCallCount()).toBe(1);
    await db.close();
    expect(slow.closeCallCount()).toBe(1);
    await expect(store.setAll([{ key: buffer("late"), value: buffer("rejected") }])).rejects.toThrow("closing");
  });

  it("only allows a single winner for concurrent compareAndSet on the same key", async () => {
    const slow = createSlowSetDatabase();
    const db = declareInstantAvailabilityLowLevelDatabase(slow.db, { dbId: "instant-test" });
    const store = db.declareKvStore("store");

    // Seed the key so both racers observe the same starting value from the in-memory cache.
    await store.setAll([{ key: buffer("key"), value: buffer("start") }]);

    // Launch both compare-and-sets concurrently. The read+compare must be gated together with
    // the write, so exactly one of them may observe "start" and win — the other must lose.
    const [first, second] = await Promise.all([
      store.compareAndSet(buffer("key"), buffer("start"), buffer("a")),
      store.compareAndSet(buffer("key"), buffer("start"), buffer("b")),
    ]);

    const winners = [first, second].filter(result => result.wasSet);
    const losers = [first, second].filter(result => !result.wasSet);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].seq).toBeNull();
    // Only the winner's write should have reached the wrapped store (plus the seed set).
    expect(slow.setCallCount()).toBe(2);

    // The stored value must reflect the single winner.
    expect(text((await store.get(buffer("key"))).buffer)).toBe(first.wasSet ? "a" : "b");
  });
});
