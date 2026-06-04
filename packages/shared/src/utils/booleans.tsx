export type Truthy<T> = T extends null | undefined | 0 | "" | false ? false : true;
export type Falsy<T> = T extends null | undefined | 0 | "" | false ? true : false;

export function isTruthy<T>(value: T): value is T & Truthy<T> {
  return !!value;
}
import.meta.vitest?.test("isTruthy", ({ expect }) => {
  expect(isTruthy(true)).toBe(true);
  expect(isTruthy(1)).toBe(true);
  expect(isTruthy("hello")).toBe(true);
  expect(isTruthy({})).toBe(true);
  expect(isTruthy([])).toBe(true);
  expect(isTruthy(false)).toBe(false);
  expect(isTruthy(0)).toBe(false);
  expect(isTruthy("")).toBe(false);
  expect(isTruthy(null)).toBe(false);
  expect(isTruthy(undefined)).toBe(false);
});

export function isFalsy<T>(value: T): value is T & Falsy<T> {
  return !value;
}
import.meta.vitest?.test("isFalsy", ({ expect }) => {
  expect(isFalsy(false)).toBe(true);
  expect(isFalsy(0)).toBe(true);
  expect(isFalsy("")).toBe(true);
  expect(isFalsy(null)).toBe(true);
  expect(isFalsy(undefined)).toBe(true);
  expect(isFalsy(true)).toBe(false);
  expect(isFalsy(1)).toBe(false);
  expect(isFalsy("hello")).toBe(false);
  expect(isFalsy({})).toBe(false);
  expect(isFalsy([])).toBe(false);
});
