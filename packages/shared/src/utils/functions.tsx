export function identity<T>(t: T): T {
  return t;
}
import.meta.vitest?.test("identity", ({ expect }) => {
  expect(identity(1)).toBe(1);
  expect(identity("test")).toBe("test");
  expect(identity(null)).toBe(null);
  expect(identity(undefined)).toBe(undefined);
  const obj = { a: 1 };
  expect(identity(obj)).toBe(obj);
});

export function identityArgs<T extends any[]>(...args: T): T {
  return args;
}
import.meta.vitest?.test("identityArgs", ({ expect }) => {
  expect(identityArgs()).toEqual([]);
  expect(identityArgs(1)).toEqual([1]);
  expect(identityArgs(1, 2, 3)).toEqual([1, 2, 3]);
  expect(identityArgs("a", "b", "c")).toEqual(["a", "b", "c"]);
  expect(identityArgs(null, undefined)).toEqual([null, undefined]);
});
