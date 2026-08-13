import { describe, expect, it } from "vitest";
import { declareInMemoryPiledriverDatabase } from "./in-memory.js";
import { declareBufferedPiledriverDatabase } from "./buffered.js";
import type { PiledriverDatabase } from "../index.js";

const key = (value: string) => new TextEncoder().encode(value).buffer;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

function countingDatabase() {
  const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());
  let writes = 0;
  const counted: PiledriverDatabase = {
    ...wrapped,
    async setRootObject(rootKey, value) {
      writes++;
      return await wrapped.setRootObject(rootKey, value);
    },
    async deleteRootObject(rootKey) {
      writes++;
      return await wrapped.deleteRootObject(rootKey);
    },
  };
  return { wrapped, counted, getWrites: () => writes };
}

describe("BufferedPiledriverDatabase", () => {
  it("reads pending writes immediately", async () => {
    const { counted } = countingDatabase();
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 50 });
    const rootKey = key("read-your-writes");

    await db.setRootObject(rootKey, "value");

    await expect(db.getRootObject(rootKey)).resolves.toMatchObject({ object: "value" });
  });

  it("coalesces writes to one key within the throttle window", async () => {
    const { counted, getWrites } = countingDatabase();
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 20 });
    const rootKey = key("coalesce");

    const first = await db.setRootObject(rootKey, "first");
    await db.waitUntilDurable(first.seq);
    const second = await db.setRootObject(rootKey, "second");
    const third = await db.setRootObject(rootKey, "third");
    await db.waitUntilDurable(third.seq);

    expect(getWrites()).toBe(2);
    await expect(counted.getRootObject(rootKey)).resolves.toMatchObject({ object: "third" });
  });

  it("reads pending deletions as missing roots", async () => {
    const { counted } = countingDatabase();
    const rootKey = key("delete");
    await counted.setRootObject(rootKey, "value");
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 50 });

    const { seq } = await db.deleteRootObject(rootKey);

    await expect(db.getRootObject(rootKey)).rejects.toThrow("Root object not found");
    await db.waitUntilDurable(seq);
    await expect(counted.getRootObject(rootKey)).rejects.toThrow("Root object not found");
  });

  it("keeps all in-flight writes visible while the flush is blocked", async () => {
    const gate = deferred<void>();
    const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());
    const delayed: PiledriverDatabase = {
      ...wrapped,
      async setRootObject(rootKey, value) {
        if (value === "first") await gate.promise;
        return await wrapped.setRootObject(rootKey, value);
      },
    };
    const db = declareBufferedPiledriverDatabase(delayed, { throttleMs: 50 });
    const firstKey = key("in-flight-first");
    const secondKey = key("in-flight-second");

    const first = db.setRootObject(firstKey, "first");
    const second = db.setRootObject(secondKey, "second");
    await Promise.resolve();

    await expect(db.getRootObject(firstKey)).resolves.toMatchObject({ object: "first" });
    await expect(db.getRootObject(secondKey)).resolves.toMatchObject({ object: "second" });
    gate.resolve();
    await db.waitUntilDurable((await first).seq);
    await db.waitUntilDurable((await second).seq);
  });

  it("waits for every member of a combined sequence", async () => {
    const gate = deferred<void>();
    const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());
    let writes = 0;
    const delayed: PiledriverDatabase = {
      ...wrapped,
      async setRootObject(rootKey, value) {
        writes++;
        if (writes === 1) await gate.promise;
        return await wrapped.setRootObject(rootKey, value);
      },
    };
    const db = declareBufferedPiledriverDatabase(delayed, { throttleMs: 50 });
    const firstKey = key("combined-first");
    const secondKey = key("combined-second");
    const first = await db.setRootObject(firstKey, "first");
    await Promise.resolve();
    const second = await db.setRootObject(secondKey, "second");
    const combined = db.combineSeqs(second.seq, first.seq);
    gate.resolve();

    await db.waitUntilDurable(combined);

    await expect(wrapped.getRootObject(firstKey)).resolves.toMatchObject({ object: "first" });
    await expect(wrapped.getRootObject(secondKey)).resolves.toMatchObject({ object: "second" });
  });

  it("rejects combined sequences from another buffered database synchronously", async () => {
    const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());
    const first = declareBufferedPiledriverDatabase(wrapped, { throttleMs: 50 });
    const second = declareBufferedPiledriverDatabase(wrapped, { throttleMs: 50 });
    const { seq } = await first.setRootObject(key("foreign"), "value");

    expect(() => second.combineSeqs(seq)).toThrow("does not belong to this database");
  });

  it("waits for a single-member combined sequence", async () => {
    const { wrapped, counted } = countingDatabase();
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 20 });
    const { seq } = await db.setRootObject(key("single-combined"), "value");

    await db.waitUntilDurable(db.combineSeqs(seq));

    await expect(wrapped.getRootObject(key("single-combined"))).resolves.toMatchObject({ object: "value" });
  });

  it("rejects a durability waiter once without retrying a failed write", async () => {
    const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());
    let attempts = 0;
    const failing: PiledriverDatabase = {
      ...wrapped,
      async setRootObject() {
        attempts++;
        throw new Error("write failed");
      },
    };
    const db = declareBufferedPiledriverDatabase(failing, { throttleMs: 0 });
    const { seq } = await db.setRootObject(key("failure"), "value");

    await expect(db.waitUntilDurable(seq)).rejects.toThrow("write failed");
    expect(attempts).toBe(1);
    await expect(db.getRootObject(key("failure"))).resolves.toMatchObject({ object: "value" });
  });

  it("wraps sequences returned by fallthrough reads", async () => {
    const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());
    const rootKey = key("fallthrough");
    const { seq: wrappedSeq } = await wrapped.setRootObject(rootKey, "value");
    const durableSeqs: PiledriverDatabase["initialSeq"][] = [];
    const observed: PiledriverDatabase = {
      ...wrapped,
      async waitUntilDurable(seq) {
        durableSeqs.push(seq);
        await wrapped.waitUntilDurable(seq);
      },
    };
    const db = declareBufferedPiledriverDatabase(observed);

    const { seq } = await db.getRootObject(rootKey);
    await db.waitUntilDurable(seq);
    await db.waitUntilDurable(db.combineSeqs(seq));
    expect(durableSeqs).toEqual([wrappedSeq, wrappedSeq]);
  });

  it("waits for the scheduled flush before durable completion", async () => {
    const { wrapped, counted } = countingDatabase();
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 20 });
    const rootKey = key("durable");

    const { seq } = await db.setRootObject(rootKey, "value");
    await db.waitUntilDurable(seq);

    await expect(wrapped.getRootObject(rootKey)).resolves.toMatchObject({ object: "value" });
  });

  it("flushes on close", async () => {
    const { wrapped, counted } = countingDatabase();
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 50 });
    const rootKey = key("close");

    await db.setRootObject(rootKey, "value");
    await db.close();

    await expect(wrapped.getRootObject(rootKey)).resolves.toMatchObject({ object: "value" });
    await db.close();
  });

  it("supports an immediate throttle window", async () => {
    const { wrapped, counted } = countingDatabase();
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 0 });
    const rootKey = key("zero");

    const { seq } = await db.setRootObject(rootKey, "value");
    await db.waitUntilDurable(seq);

    await expect(wrapped.getRootObject(rootKey)).resolves.toMatchObject({ object: "value" });
  });

  it("rejects invalid throttle windows", () => {
    const wrapped = declareInMemoryPiledriverDatabase(crypto.randomUUID());

    expect(() => declareBufferedPiledriverDatabase(wrapped, { throttleMs: -1 })).toThrow("throttleMs");
    expect(() => declareBufferedPiledriverDatabase(wrapped, { throttleMs: Number.NaN })).toThrow("throttleMs");
    expect(() => declareBufferedPiledriverDatabase(wrapped, { throttleMs: Number.POSITIVE_INFINITY })).toThrow("throttleMs");
    expect(() => declareBufferedPiledriverDatabase(wrapped, { throttleMs: 2 ** 31 })).toThrow("throttleMs");
  });
});
