import { remainder } from "./math";

export function typedIncludes<T extends readonly any[]>(arr: T, item: unknown): item is T[number] {
  return arr.includes(item);
}
import.meta.vitest?.test("typedIncludes", ({ expect }) => {
  const arr = [1, 2, 3] as const;
  expect(typedIncludes(arr, 1)).toBe(true);
  expect(typedIncludes(arr, 4)).toBe(false);
  expect(typedIncludes(arr, "1")).toBe(false);

  const strArr = ["a", "b", "c"] as const;
  expect(typedIncludes(strArr, "a")).toBe(true);
  expect(typedIncludes(strArr, "d")).toBe(false);
});

export function enumerate<T extends readonly any[]>(arr: T): [number, T[number]][] {
  return arr.map((item, index) => [index, item]);
}
import.meta.vitest?.test("enumerate", ({ expect }) => {
  expect(enumerate([])).toEqual([]);
  expect(enumerate([1, 2, 3])).toEqual([[0, 1], [1, 2], [2, 3]]);
  expect(enumerate(["a", "b", "c"])).toEqual([[0, "a"], [1, "b"], [2, "c"]]);
});

export function isShallowEqual(a: readonly any[], b: readonly any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
import.meta.vitest?.test("isShallowEqual", ({ expect }) => {
  expect(isShallowEqual([], [])).toBe(true);
  expect(isShallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  expect(isShallowEqual([1, 2, 3], [1, 2, 4])).toBe(false);
  expect(isShallowEqual([1, 2, 3], [1, 2])).toBe(false);
  expect(isShallowEqual([1, 2], [1, 2, 3])).toBe(false);
  // Test with objects (reference equality)
  const obj1 = { a: 1 };
  const obj2 = { a: 1 };
  expect(isShallowEqual([obj1], [obj1])).toBe(true);
  expect(isShallowEqual([obj1], [obj2])).toBe(false);
});

/**
 * Ponyfill for ES2023's findLastIndex.
 */
export function findLastIndex<T>(arr: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}
import.meta.vitest?.test("findLastIndex", ({ expect }) => {
  expect(findLastIndex([], () => true)).toBe(-1);
  expect(findLastIndex([1, 2, 3, 4, 5], x => x % 2 === 0)).toBe(3); // 4 is at index 3
  expect(findLastIndex([1, 2, 3, 4, 5], x => x > 10)).toBe(-1);
  expect(findLastIndex([1, 2, 3, 2, 1], x => x === 2)).toBe(3);
  expect(findLastIndex([1, 2, 3], x => x === 1)).toBe(0);
});

export function groupBy<T extends any, K>(
  arr: Iterable<T>,
  key: (item: T) => K,
): Map<K, T[]> {
  const result = new Map<K, T[]>;
  for (const item of arr) {
    const k = key(item);
    if (result.get(k) === undefined) result.set(k, []);
    result.get(k)!.push(item);
  }
  return result;
}
import.meta.vitest?.test("groupBy", ({ expect }) => {
  expect(groupBy([], (x) => x)).toEqual(new Map());

  const numbers = [1, 2, 3, 4, 5, 6];
  const grouped = groupBy(numbers, (n) => n % 2 === 0 ? "even" : "odd");
  expect(grouped.get("even")).toEqual([2, 4, 6]);
  expect(grouped.get("odd")).toEqual([1, 3, 5]);

  // Check the actual lengths of the words to ensure our test is correct
  const words = ["apple", "banana", "cherry", "date", "elderberry"];

  const byLength = groupBy(words, (w) => w.length);
  // Adjust expectations based on actual word lengths
  expect(byLength.get(5)).toEqual(["apple"]);
  expect(byLength.get(6)).toEqual(["banana", "cherry"]);
  expect(byLength.get(4)).toEqual(["date"]);
  expect(byLength.get(10)).toEqual(["elderberry"]);
});

export function range(endExclusive: number): number[];
export function range(startInclusive: number, endExclusive: number): number[];
export function range(startInclusive: number, endExclusive: number, step: number): number[];
export function range(startInclusive: number, endExclusive?: number, step?: number): number[] {
  if (endExclusive === undefined) {
    endExclusive = startInclusive;
    startInclusive = 0;
  }
  if (step === undefined) step = 1;

  const result = [];
  for (let i = startInclusive; step > 0 ? (i < endExclusive) : (i > endExclusive); i += step) {
    result.push(i);
  }
  return result;
}
import.meta.vitest?.test("range", ({ expect }) => {
  expect(range(5)).toEqual([0, 1, 2, 3, 4]);
  expect(range(2, 5)).toEqual([2, 3, 4]);
  expect(range(1, 10, 2)).toEqual([1, 3, 5, 7, 9]);
  expect(range(5, 0, -1)).toEqual([5, 4, 3, 2, 1]);
  expect(range(0, 0)).toEqual([]);
  expect(range(0, 10, 3)).toEqual([0, 3, 6, 9]);
});


export function rotateLeft(arr: readonly any[], n: number): any[] {
  if (arr.length === 0) return [];
  const index = remainder(n, arr.length);
  return [...arr.slice(index), ...arr.slice(0, index)];
}
import.meta.vitest?.test("rotateLeft", ({ expect }) => {
  expect(rotateLeft([], 1)).toEqual([]);
  expect(rotateLeft([1, 2, 3, 4, 5], 0)).toEqual([1, 2, 3, 4, 5]);
  expect(rotateLeft([1, 2, 3, 4, 5], 1)).toEqual([2, 3, 4, 5, 1]);
  expect(rotateLeft([1, 2, 3, 4, 5], 3)).toEqual([4, 5, 1, 2, 3]);
  expect(rotateLeft([1, 2, 3, 4, 5], 5)).toEqual([1, 2, 3, 4, 5]);
  expect(rotateLeft([1, 2, 3, 4, 5], 6)).toEqual([2, 3, 4, 5, 1]);
});

export function rotateRight(arr: readonly any[], n: number): any[] {
  return rotateLeft(arr, -n);
}
import.meta.vitest?.test("rotateRight", ({ expect }) => {
  expect(rotateRight([], 1)).toEqual([]);
  expect(rotateRight([1, 2, 3, 4, 5], 0)).toEqual([1, 2, 3, 4, 5]);
  expect(rotateRight([1, 2, 3, 4, 5], 1)).toEqual([5, 1, 2, 3, 4]);
  expect(rotateRight([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5, 1, 2]);
  expect(rotateRight([1, 2, 3, 4, 5], 5)).toEqual([1, 2, 3, 4, 5]);
  expect(rotateRight([1, 2, 3, 4, 5], 6)).toEqual([5, 1, 2, 3, 4]);
});


export function shuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
import.meta.vitest?.test("shuffle", ({ expect }) => {
  // Test empty array
  expect(shuffle([])).toEqual([]);

  // Test single element array
  expect(shuffle([1])).toEqual([1]);

  // Test that shuffle returns a new array
  const original = [1, 2, 3, 4, 5];
  const shuffled = shuffle(original);
  expect(shuffled).not.toBe(original);

  // Test that all elements are preserved
  expect(shuffled.sort((a, b) => a - b)).toEqual(original);

  // Test with a larger array to ensure randomness
  // This is a probabilistic test, but it's very unlikely to fail
  const large = Array.from({ length: 100 }, (_, i) => i);
  const shuffledLarge = shuffle(large);
  expect(shuffledLarge).not.toEqual(large);
  expect(shuffledLarge.sort((a, b) => a - b)).toEqual(large);
});


export function outerProduct<T, U>(arr1: readonly T[], arr2: readonly U[]): [T, U][] {
  return arr1.flatMap((item1) => arr2.map((item2) => [item1, item2] as [T, U]));
}
import.meta.vitest?.test("outerProduct", ({ expect }) => {
  expect(outerProduct([], [])).toEqual([]);
  expect(outerProduct([1], [])).toEqual([]);
  expect(outerProduct([], [1])).toEqual([]);
  expect(outerProduct([1], [2])).toEqual([[1, 2]]);
  expect(outerProduct([1, 2], [3, 4])).toEqual([[1, 3], [1, 4], [2, 3], [2, 4]]);
  expect(outerProduct(["a", "b"], [1, 2])).toEqual([["a", 1], ["a", 2], ["b", 1], ["b", 2]]);
});

export function unique<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}
import.meta.vitest?.test("unique", ({ expect }) => {
  expect(unique([])).toEqual([]);
  expect(unique([1, 2, 3])).toEqual([1, 2, 3]);
  expect(unique([1, 2, 2, 3, 1, 3])).toEqual([1, 2, 3]);
  // Test with objects (reference equality)
  const obj = { a: 1 };
  expect(unique([obj, obj])).toEqual([obj]);
  // Test with different types
  expect(unique([1, "1", true, 1, "1", true])).toEqual([1, "1", true]);
});
