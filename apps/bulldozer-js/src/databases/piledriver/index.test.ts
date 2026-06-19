import { describe, expect, it } from "vitest";
import { piledriverObjectEquals } from "./index.js";

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
