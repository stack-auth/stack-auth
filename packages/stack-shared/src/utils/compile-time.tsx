/**
 * Returns the first argument passed to it, but compilers won't be able to optimize it out. This is useful in some
 * cases where compiler warnings go awry; for example, when importing things that may not exist (but are guaranteed
 * to exist at runtime).
 */
export function scrambleDuringCompileTime<T>(t: T): T {
  return t;
}
import.meta.vitest?.test("scrambleDuringCompileTime", ({ expect }) => {
  // Test with primitive values
  expect(scrambleDuringCompileTime(42)).toBe(42);
  expect(scrambleDuringCompileTime("hello")).toBe("hello");
  expect(scrambleDuringCompileTime(true)).toBe(true);
  expect(scrambleDuringCompileTime(null)).toBe(null);
  expect(scrambleDuringCompileTime(undefined)).toBe(undefined);

  // Test with objects (reference equality)
  const obj = { a: 1 };
  expect(scrambleDuringCompileTime(obj)).toBe(obj);

  // Test with arrays (reference equality)
  const arr = [1, 2, 3];
  expect(scrambleDuringCompileTime(arr)).toBe(arr);

  // Test with functions (reference equality)
  const fn = () => "test";
  expect(scrambleDuringCompileTime(fn)).toBe(fn);
});
