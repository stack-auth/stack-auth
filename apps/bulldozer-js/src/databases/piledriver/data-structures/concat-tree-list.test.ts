import { describe, expect, it } from "vitest";
import { ConcatTreeList } from "./concat-tree-list.js";

async function arrayFrom<T>(iterable: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const item of iterable) result.push(item);
  return result;
}

describe("ConcatTreeList", () => {
  it("iterates concatenated lists in order", async () => {
    const list = ConcatTreeList.concat([
      ConcatTreeList.from<number>([1, 2]),
      ConcatTreeList.from<number>([3]),
      ConcatTreeList.from<number>([4, 5]),
    ]);

    expect(await list.size()).toBe(5);
    expect(await arrayFrom(list)).toEqual([1, 2, 3, 4, 5]);
  });

  it("supports synchronous structural concat", async () => {
    const list = ConcatTreeList.concat([
      ConcatTreeList.fromEntries<number>([["a", 1]]),
      ConcatTreeList.fromEntries<number>([["b", 2]]),
    ]);

    expect(await arrayFrom(list.entries())).toEqual([["a", 1], ["b", 2]]);
  });

  it("iterates stable entries", async () => {
    const list = ConcatTreeList.fromEntries<number>([["a", 1], ["b", 2]]);

    expect(await arrayFrom(list.entries())).toEqual([["a", 1], ["b", 2]]);
    expect(await arrayFrom(list)).toEqual([1, 2]);
  });

  it("supports random access", async () => {
    const list = ConcatTreeList.concat([
      ConcatTreeList.from(["a", "b"]),
      ConcatTreeList.from(["c"]),
      ConcatTreeList.empty<string>(),
      ConcatTreeList.from(["d"]),
    ], { arity: 2 });

    expect(await list.get(-1)).toBeUndefined();
    expect(await list.get(0)).toBe("a");
    expect(await list.get(2)).toBe("c");
    expect(await list.get(3)).toBe("d");
    expect(await list.get(4)).toBeUndefined();
  });

  it("can merge adjacent boundaries", async () => {
    const list = await ConcatTreeList.concatWithMergedBoundaries([
      ConcatTreeList.from([1, 2, 3]),
      ConcatTreeList.empty<number>(),
      ConcatTreeList.from([3, 4, 5]),
      ConcatTreeList.from([5, 6]),
    ], {
      mergeBoundary: (leftLast, rightFirst) => leftLast === rightFirst ? [leftLast] : [leftLast, rightFirst],
    });

    expect(await arrayFrom(list)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("preserves boundary identifiers when merging adjacent rows", async () => {
    const list = await ConcatTreeList.concatWithMergedBoundaries([
      ConcatTreeList.fromEntries<number>([["a", 1], ["b", 2]]),
      ConcatTreeList.fromEntries<number>([["c", 3], ["d", 4]]),
    ], {
      mergeBoundary: (leftLast, rightFirst) => [leftLast + rightFirst],
    });

    expect(await ConcatTreeList.diff(
      ConcatTreeList.fromEntries<number>([["a", 1], ["b", 2], ["d", 4]]),
      list,
    )).toEqual({
      missing: [{ id: "b", value: 2 }],
      added: [{ id: "b", value: 5 }],
    });
  });

  it("diffs missing and added rows", async () => {
    const sharedPrefix = ConcatTreeList.fromEntries<number>([["a", 1], ["b", 2]]);
    const left = ConcatTreeList.concat<number>([sharedPrefix, ConcatTreeList.fromEntries<number>([["c", 3], ["d", 4]])]);
    const right = ConcatTreeList.concat<number>([sharedPrefix, ConcatTreeList.fromEntries<number>([["c", 3], ["e", 5], ["f", 6]])]);

    expect(await ConcatTreeList.diff(left, right)).toEqual({
      missing: [{ id: "d", value: 4 }],
      added: [{ id: "e", value: 5 }, { id: "f", value: 6 }],
    });
  });

  it("diffs sorted lists by ordered membership", async () => {
    expect(await ConcatTreeList.diff(
      ConcatTreeList.fromEntries<number>([["a", 1], ["b", 2], ["c", 4], ["d", 5]]),
      ConcatTreeList.fromEntries<number>([["a", 1], ["e", 3], ["d", 5]]),
    )).toEqual({
      missing: [{ id: "b", value: 2 }, { id: "c", value: 4 }, { id: "d", value: 5 }],
      added: [{ id: "e", value: 3 }, { id: "d", value: 5 }],
    });
  });

  it("diffs order changes as missing and added", async () => {
    expect(await ConcatTreeList.diff(
      ConcatTreeList.fromEntries<number>([["a", 1], ["b", 2], ["c", 3]]),
      ConcatTreeList.fromEntries<number>([["a", 1], ["c", 3], ["b", 2]]),
    )).toEqual({
      missing: [{ id: "b", value: 2 }, { id: "c", value: 3 }],
      added: [{ id: "c", value: 3 }, { id: "b", value: 2 }],
    });
  });

  it("round-trips through piledriver objects", async () => {
    const list = ConcatTreeList.fromPiledriverObject<{ value: number }>(
      ConcatTreeList.from([{ value: 1 }, { value: 2 }]).toPiledriverObject(),
    );

    expect(await arrayFrom(list)).toEqual([{ value: 1 }, { value: 2 }]);
  });
});
