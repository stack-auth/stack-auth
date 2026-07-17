import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { declareInMemoryLowLevelDatabase } from "../low-level/implementations/in-memory.js";
import { collectPiledriverGarbage } from "./gc.js";
import { asHeapObject, declarePiledriverDatabase, isPiledriverHeapObjectSymbol, PiledriverObject } from "./index.js";

const rootKey = new TextEncoder().encode("root").buffer;
const otherRootKey = new TextEncoder().encode("other").buffer;

// A large-ish unique payload per commit so each root references a distinct heap object.
const bigValue = (tag: string) => ({ tag, blob: tag.repeat(64) });

function heapChild(object: PiledriverObject, propertyName: string) {
  if (typeof object !== "object" || object === null || Array.isArray(object) || isPiledriverHeapObjectSymbol in object) {
    throw new Error(`Expected a plain root object to read "${propertyName}" from`);
  }
  const child = object[propertyName];
  if (typeof child !== "object" || child === null || Array.isArray(child) || !(isPiledriverHeapObjectSymbol in child)) {
    throw new Error(`Expected "${propertyName}" to be a heap object`);
  }
  return child;
}

describe("collectPiledriverGarbage", () => {
  // Only Date is faked; root-history keys embed Date.now(), which is what we control here. M is left
  // at its default (Infinity) in these tests, so performance.now()-based expiry is irrelevant.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes heap objects unreachable from every retained root, keeping the current root's closure", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const db = declarePiledriverDatabase(lowLevel, { enableRootHistory: true });

    vi.setSystemTime(0);
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("v1")) });
    vi.setSystemTime(10 * 60_000); // +10 min
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("v2")) });

    // Two heap objects exist (v1 now orphaned; current root references only v2).
    expect((await lowLevel.debugSnapshot!()).dumps.heap).toHaveLength(2);

    // Retention long enough to cover both history entries (committed at 0 and 10min): nothing is
    // unreachable, so nothing is collected.
    const now = 20 * 60_000;
    const dry = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 25 * 60_000, now });
    expect(dry).toMatchObject({ totalHeapObjectCount: 2, liveHeapObjectCount: 2, deletedHeapObjectCount: 0, prunedRootHistoryCount: 0 });

    // Short retention: both history entries age out, only the current root (referencing v2) is
    // retained, so the orphaned v1 is collected and both stale history entries pruned.
    const result = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 5 * 60_000, now });
    expect(result).toMatchObject({ totalHeapObjectCount: 2, liveHeapObjectCount: 1, deletedHeapObjectCount: 1, prunedRootHistoryCount: 2 });
    expect((await lowLevel.debugSnapshot!()).dumps.heap).toHaveLength(1);

    // The database is still usable and the current root's data is intact after collection.
    const reader = declarePiledriverDatabase(lowLevel, { enableRootHistory: true });
    const { object } = await reader.getRootObject(rootKey);
    expect(await heapChild(object, "a").get()).toEqual(bigValue("v2"));
  });

  it("retains a recently-orphaned object while it is still within the retention window", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const db = declarePiledriverDatabase(lowLevel, { enableRootHistory: true });

    vi.setSystemTime(0);
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("v1")) });
    vi.setSystemTime(60_000); // +1 min: v1 becomes orphaned but was referenced by a root only 1 min ago
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("v2")) });

    // now = 2 min; retention = 5 min covers the root committed at 0 (which references v1) -> v1 retained.
    const result = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 5 * 60_000, now: 2 * 60_000 });
    expect(result).toMatchObject({ liveHeapObjectCount: 2, deletedHeapObjectCount: 0, prunedRootHistoryCount: 0 });
  });

  it("computes transitive reachability through nested heap references", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const db = declarePiledriverDatabase(lowLevel, { enableRootHistory: true });

    vi.setSystemTime(0);
    // root -> outer -> inner (two chained heap objects).
    await db.setRootObject(rootKey, { outer: asHeapObject({ inner: asHeapObject({ leaf: "deep" }) }) });
    expect((await lowLevel.debugSnapshot!()).dumps.heap).toHaveLength(2);

    // Both are reachable from the current root: nothing collected even with tiny retention.
    const keepAll = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 0, now: 10 * 60_000, dryRun: true });
    expect(keepAll).toMatchObject({ totalHeapObjectCount: 2, liveHeapObjectCount: 2, deletedHeapObjectCount: 0 });

    // Replace the whole root so both outer and inner become unreachable, then collect with retention
    // that excludes the old root: the entire chain is collected transitively.
    vi.setSystemTime(60_000);
    await db.setRootObject(rootKey, { plain: "no-heap" });
    const collected = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 30_000, now: 2 * 60_000 });
    expect(collected).toMatchObject({ liveHeapObjectCount: 0, deletedHeapObjectCount: 2 });
    expect((await lowLevel.debugSnapshot!()).dumps.heap).toHaveLength(0);
  });

  it("keeps objects reachable from any of several distinct current roots", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const db = declarePiledriverDatabase(lowLevel, { enableRootHistory: true });

    vi.setSystemTime(0);
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("root-a")) });
    await db.setRootObject(otherRootKey, { b: asHeapObject(bigValue("root-b")) });

    // Both current roots (in the `root` store) are always retained regardless of history retention.
    const result = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 0, now: 10 * 60_000 });
    expect(result).toMatchObject({ retainedRootCount: 2, totalHeapObjectCount: 2, liveHeapObjectCount: 2, deletedHeapObjectCount: 0 });
  });

  it("does not delete anything in dryRun mode", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const db = declarePiledriverDatabase(lowLevel, { enableRootHistory: true });

    vi.setSystemTime(0);
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("v1")) });
    vi.setSystemTime(10 * 60_000);
    await db.setRootObject(rootKey, { a: asHeapObject(bigValue("v2")) });

    const dry = await collectPiledriverGarbage(lowLevel, { rootHistoryRetentionMs: 60_000, now: 20 * 60_000, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, deletedHeapObjectCount: 1, prunedRootHistoryCount: 2 });
    // Nothing actually removed.
    expect((await lowLevel.debugSnapshot!()).dumps.heap).toHaveLength(2);
  });
});
