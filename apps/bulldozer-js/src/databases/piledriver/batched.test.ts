import { encodeBase64 } from "@hexclave/shared/dist/utils/bytes";
import { describe, expect, it } from "vitest";
import { DatabaseSeq } from "../index.js";
import { declareInMemoryLowLevelDatabase } from "../low-level/implementations/in-memory.js";
import { declareBatchedPiledriverDatabase } from "./batched.js";
import { declarePiledriverDatabase, PiledriverDatabase, PiledriverObject } from "./index.js";

const encoder = new TextEncoder();
const keyOf = (value: string) => encoder.encode(value).buffer;

type FakeBase = PiledriverDatabase & {
  setCount: number,
  deleteCount: number,
  lastSetValueByKey: Map<string, PiledriverObject>,
  durableSeqs: DatabaseSeq[],
  availableSeqs: DatabaseSeq[],
};

// A PiledriverDatabase that counts underlying calls, used to assert batching behavior. It delegates
// to a real in-memory piledriver base so all seqs are genuine DatabaseSeq values (no casts needed).
function createCountingBase(): FakeBase {
  const inner = declarePiledriverDatabase(declareInMemoryLowLevelDatabase(crypto.randomUUID()));
  const lastSetValueByKey = new Map<string, PiledriverObject>();
  const durableSeqs: DatabaseSeq[] = [];
  const availableSeqs: DatabaseSeq[] = [];
  const keyBase64 = (key: ArrayBuffer) => encodeBase64(new Uint8Array(key));

  return {
    setCount: 0,
    deleteCount: 0,
    lastSetValueByKey,
    durableSeqs,
    availableSeqs,
    getDebugInfo() {
      return inner.getDebugInfo();
    },
    async getRootObject(key) {
      return await inner.getRootObject(key);
    },
    async setRootObject(key, value) {
      this.setCount++;
      lastSetValueByKey.set(keyBase64(key), value);
      return await inner.setRootObject(key, value);
    },
    async deleteRootObject(key) {
      this.deleteCount++;
      return await inner.deleteRootObject(key);
    },
    async waitUntilAvailable(seq) {
      availableSeqs.push(seq);
      await inner.waitUntilAvailable(seq);
    },
    async waitUntilDurable(seq) {
      durableSeqs.push(seq);
      await inner.waitUntilDurable(seq);
    },
    async waitUntilReplicated(seq) {
      durableSeqs.push(seq);
      await inner.waitUntilReplicated(seq);
    },
    combineSeqs(...seqs) {
      return inner.combineSeqs(...seqs);
    },
    initialSeq: inner.initialSeq,
  };
}

// Resolves once the given promise settles or a microtask/timer boundary passes, whichever is first,
// so we can assert that a promise has NOT resolved yet without hanging the test.
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const sentinel = Symbol("pending");
  const winner = await Promise.race([promise.then(() => "resolved"), new Promise(resolve => setTimeout(() => resolve(sentinel), 20))]);
  return winner === sentinel;
}

describe("declareBatchedPiledriverDatabase", () => {
  it("serves the latest set value from memory before any flush", async () => {
    const base = createCountingBase();
    const batched = declareBatchedPiledriverDatabase(base, { batchIntervalMs: 10_000 });
    const key = keyOf("root");

    await batched.setRootObject(key, { value: 1 });
    const { object } = await batched.getRootObject(key);

    expect(object).toEqual({ value: 1 });
    expect(base.setCount).toBe(0);

    await batched.close();
  });

  it("coalesces rapid writes to one key into a single underlying set with the last value", async () => {
    const base = createCountingBase();
    const batched = declareBatchedPiledriverDatabase(base, { batchIntervalMs: 10_000 });
    const key = keyOf("root");

    for (let i = 0; i < 25; i++) await batched.setRootObject(key, { value: i });
    expect(base.setCount).toBe(0);

    await batched.flushAll();

    expect(base.setCount).toBe(1);
    expect(base.deleteCount).toBe(0);
    expect(base.lastSetValueByKey.get(encodeBase64(new Uint8Array(key)))).toEqual({ value: 24 });

    await batched.close();
  });

  it("coalesces a set followed by a delete into a single underlying delete and reports not-found", async () => {
    const base = createCountingBase();
    const batched = declareBatchedPiledriverDatabase(base, { batchIntervalMs: 10_000 });
    const key = keyOf("root");

    await batched.setRootObject(key, { value: 1 });
    await batched.deleteRootObject(key);
    await expect(batched.getRootObject(key)).rejects.toThrow("Root object not found");

    await batched.flushAll();

    expect(base.setCount).toBe(0);
    expect(base.deleteCount).toBe(1);
    await expect(batched.getRootObject(key)).rejects.toThrow("Root object not found");

    await batched.close();
  });

  it("resolves waitUntilAvailable immediately but waitUntilDurable/Replicated only after the flush delegates to the base", async () => {
    const base = createCountingBase();
    const batched = declareBatchedPiledriverDatabase(base, { batchIntervalMs: 10_000 });
    const key = keyOf("root");

    const { seq } = await batched.setRootObject(key, { value: 1 });

    // Available resolves without a flush having occurred.
    await batched.waitUntilAvailable(seq);
    expect(base.setCount).toBe(0);

    const durablePromise = batched.waitUntilDurable(seq);
    const replicatedPromise = batched.waitUntilReplicated(seq);
    expect(await isPending(durablePromise)).toBe(true);
    expect(await isPending(replicatedPromise)).toBe(true);
    expect(base.durableSeqs).toHaveLength(0);

    await batched.flushAll();
    await durablePromise;
    await replicatedPromise;

    expect(base.setCount).toBe(1);
    // Durable and replicated each delegated to the base once the flush produced a real base seq.
    expect(base.durableSeqs).toHaveLength(2);

    await batched.close();
  });

  it("flushes to a real in-memory piledriver base so a fresh client reads the persisted value", async () => {
    const dbId = crypto.randomUUID();
    const base = declarePiledriverDatabase(declareInMemoryLowLevelDatabase(dbId));
    const batched = declareBatchedPiledriverDatabase(base, { batchIntervalMs: 10_000 });
    const key = keyOf("root");
    const value: PiledriverObject = { nested: { list: [1, 2, 3], flag: true } };

    await batched.setRootObject(key, value);
    await batched.flushAll();

    const freshBase = declarePiledriverDatabase(declareInMemoryLowLevelDatabase(dbId));
    const { object } = await freshBase.getRootObject(key);
    expect(object).toEqual(value);

    await batched.close();
  });
});
