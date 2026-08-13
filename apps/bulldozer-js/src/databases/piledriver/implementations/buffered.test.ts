import { describe, expect, it } from "vitest";
import { declareInMemoryPiledriverDatabase } from "./in-memory.js";
import { declareBufferedPiledriverDatabase } from "./buffered.js";
import type { PiledriverDatabase } from "../index.js";

const key = (value: string) => new TextEncoder().encode(value).buffer;
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

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

    const first = db.setRootObject(rootKey, "first");
    const second = db.setRootObject(rootKey, "second");
    const third = db.setRootObject(rootKey, "third");
    await Promise.all([first, second, third]);
    await delay(30);

    expect(getWrites()).toBe(1);
    await expect(counted.getRootObject(rootKey)).resolves.toMatchObject({ object: "third" });
  });

  it("reads pending deletions as missing roots", async () => {
    const { counted } = countingDatabase();
    const rootKey = key("delete");
    await counted.setRootObject(rootKey, "value");
    const db = declareBufferedPiledriverDatabase(counted, { throttleMs: 50 });

    await db.deleteRootObject(rootKey);

    await expect(db.getRootObject(rootKey)).rejects.toThrow("Root object not found");
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
  });
});
