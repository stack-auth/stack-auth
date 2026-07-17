import { describe, expect, it } from "vitest";
import { LowLevelDatabase } from "../low-level/index.js";
import { declareInMemoryLowLevelDatabase } from "../low-level/implementations/in-memory.js";
import { asHeapObject, declarePiledriverDatabase, isPiledriverHeapObjectSymbol, PiledriverHeapObject, PiledriverObject, piledriverObjectEquals } from "./index.js";

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Narrows a deserialized root's named property to a heap-object handle (throwing loudly otherwise),
// so tests can exercise `.get()`/expiry without unsafe casts.
function heapChild(object: PiledriverObject, propertyName: string): PiledriverHeapObject {
  if (typeof object !== "object" || object === null || Array.isArray(object) || isPiledriverHeapObjectSymbol in object) {
    throw new Error(`Expected a plain root object to read "${propertyName}" from`);
  }
  const child = object[propertyName];
  if (typeof child !== "object" || child === null || Array.isArray(child) || !(isPiledriverHeapObjectSymbol in child)) {
    throw new Error(`Expected "${propertyName}" to be a heap object`);
  }
  return child;
}

function wrapWithHeapGetCounter(lowLevel: LowLevelDatabase, onHeapGet: () => void): LowLevelDatabase {
  return {
    ...lowLevel,
    declareKvDump(id) {
      const dump = lowLevel.declareKvDump(id);
      if (id !== "heap") return dump;
      return {
        ...dump,
        async get(key) {
          onHeapGet();
          return await dump.get(key);
        },
      };
    },
  };
}

describe("PiledriverDatabase", () => {
  it("deserializes heap references lazily", async () => {
    const key = new TextEncoder().encode("root").buffer;
    let heapGets = 0;
    const lowLevel = wrapWithHeapGetCounter(declareInMemoryLowLevelDatabase(crypto.randomUUID()), () => heapGets++);

    await declarePiledriverDatabase(lowLevel).setRootObject(key, {
      child: asHeapObject({ nested: "value" }),
    });

    const reader = declarePiledriverDatabase(lowLevel);
    const { object } = await reader.getRootObject(key);
    expect(heapGets).toBe(0);

    await reader.setRootObject(new TextEncoder().encode("copy").buffer, object);
    expect(heapGets).toBe(0);

    if (typeof object !== "object" || object === null || Array.isArray(object) || !("child" in object)) {
      throw new Error("Expected root object with child heap reference");
    }
    const { child } = object;
    if (typeof child !== "object" || child === null || Array.isArray(child) || !(isPiledriverHeapObjectSymbol in child)) {
      throw new Error("Expected child to be a heap object");
    }
    expect(await child.get()).toEqual({ nested: "value" });
    expect(heapGets).toBe(1);
  });

  it("rejects heapReferenceMaxAgeMs that is not positive or Infinity", () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    expect(() => declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: 0 })).toThrow(/heapReferenceMaxAgeMs/);
    expect(() => declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: -1 })).toThrow(/heapReferenceMaxAgeMs/);
    expect(() => declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: NaN })).toThrow(/heapReferenceMaxAgeMs/);
    // Infinity (the default) and positive finite values are accepted.
    declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: Infinity });
    declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: 1000, heapReferenceCacheSweepIntervalMs: 50 });
  });

  it("throws from a heap handle's .get() once it is older than M", async () => {
    const key = new TextEncoder().encode("root").buffer;
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const heapReferenceMaxAgeMs = 40;
    await declarePiledriverDatabase(lowLevel).setRootObject(key, { child: asHeapObject({ nested: "value" }) });

    const reader = declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs, heapReferenceCacheSweepIntervalMs: 20 });
    const { object } = await reader.getRootObject(key);
    const child = heapChild(object, "child");
    // Fresh handle (within M) reads fine.
    expect(await child.get()).toEqual({ nested: "value" });

    await wait(heapReferenceMaxAgeMs + 60);
    // The same handle, now older than M, refuses to read — even though the value was already loaded.
    await expect(child.get()).rejects.toThrow(/expired/);
  });

  it("propagates the root's referencedAt to lazily-loaded nested handles (so nested reads also expire)", async () => {
    const key = new TextEncoder().encode("root").buffer;
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const heapReferenceMaxAgeMs = 40;
    await declarePiledriverDatabase(lowLevel).setRootObject(key, {
      outer: asHeapObject({ inner: asHeapObject({ leaf: "deep" }) }),
    });

    const reader = declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs, heapReferenceCacheSweepIntervalMs: 20 });
    const { object } = await reader.getRootObject(key);
    const outer = heapChild(object, "outer");
    // Load the outer handle immediately (within M), which lazily creates the inner handle. The inner
    // handle must inherit the outer/root referencedAt rather than being stamped with `now`.
    const inner = heapChild(await outer.get(), "inner");

    await wait(heapReferenceMaxAgeMs + 60);
    // If the inner handle had been re-stamped at creation time it would still be readable here; it
    // must expire together with the root snapshot it descends from.
    await expect(inner.get()).rejects.toThrow(/expired/);
  });

  it("evicts read-cache entries once they are older than M", async () => {
    const key = new TextEncoder().encode("root").buffer;
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    await declarePiledriverDatabase(lowLevel).setRootObject(key, { child: asHeapObject({ nested: "value" }) });

    const reader = declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: 40, heapReferenceCacheSweepIntervalMs: 20 });
    // Keep a strong reference to the snapshot so the cache entry can only be removed by the age-based
    // sweep, not by weak-ref finalization.
    const { object } = await reader.getRootObject(key);
    const readCache = reader.getDebugInfo().heapObjectsByHeapKeyBase64;
    expect(readCache.size).toBeGreaterThan(0);

    await wait(120);
    expect(readCache.size).toBe(0);
    // Reference retained so it isn't collected before the assertion above.
    expect(object).toBeDefined();
  });

  it("re-inserts under a fresh key instead of reusing a stale (possibly-collected) key past M", async () => {
    const lowLevel = declareInMemoryLowLevelDatabase(crypto.randomUUID());
    const db = declarePiledriverDatabase(lowLevel, { heapReferenceMaxAgeMs: 40, heapReferenceCacheSweepIntervalMs: 20 });
    const heapObj = asHeapObject({ value: "shared" });

    await db.setRootObject(new TextEncoder().encode("a").buffer, { ref: heapObj });
    const afterFirst = await lowLevel.debugSnapshot!();
    expect(afterFirst.dumps.heap).toHaveLength(1);

    await wait(120);
    // The in-memory handle is now older than M. Committing it again must NOT reuse its old key (which
    // the GC may have collected); it must re-insert under a new key -> a second heap object appears.
    await db.setRootObject(new TextEncoder().encode("b").buffer, { ref: heapObj });
    const afterSecond = await lowLevel.debugSnapshot!();
    expect(afterSecond.dumps.heap).toHaveLength(2);
  });
});

describe("piledriverObjectEquals", () => {
  it("compares primitives", () => {
    expect(piledriverObjectEquals(1, 1)).toBe(true);
    expect(piledriverObjectEquals(1, 2)).toBe(false);
    expect(piledriverObjectEquals("a", "a")).toBe(true);
    expect(piledriverObjectEquals(null, null)).toBe(true);
    expect(piledriverObjectEquals(null, {})).toBe(false);
    expect(piledriverObjectEquals(1, "1")).toBe(false);
  });

  it("compares objects structurally without ignoring extra keys", () => {
    expect(piledriverObjectEquals({ a: 1, b: [1, { c: null }] }, { a: 1, b: [1, { c: null }] })).toBe(true);
    expect(piledriverObjectEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(piledriverObjectEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(piledriverObjectEquals({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("distinguishes arrays from objects", () => {
    expect(piledriverObjectEquals([1, 2], [1, 2])).toBe(true);
    expect(piledriverObjectEquals([1, 2], [1, 2, 3])).toBe(false);
    expect(piledriverObjectEquals({ "0": 1 }, [1])).toBe(false);
    expect(piledriverObjectEquals([], {})).toBe(false);
  });
});
