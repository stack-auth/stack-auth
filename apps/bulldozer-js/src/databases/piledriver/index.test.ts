import { describe, expect, it } from "vitest";
import { LowLevelDatabase } from "../low-level/index.js";
import { declareInMemoryLowLevelDatabase } from "../low-level/implementations/in-memory.js";
import { asHeapObject, declarePiledriverDatabase, isPiledriverHeapObjectSymbol, piledriverObjectEquals } from "./index.js";

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
