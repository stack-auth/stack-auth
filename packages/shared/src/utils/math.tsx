/**
 * Similar to the modulo operator, but always returns a positive number (even when the input is negative).
 */
export function remainder(n: number, d: number): number {
  return ((n % d) + Math.abs(d)) % d;
}
import.meta.vitest?.test("remainder", ({ expect }) => {
  expect(remainder(10, 3)).toBe(1);
  expect(remainder(10, 5)).toBe(0);
  expect(remainder(10, 7)).toBe(3);
  // Test with negative numbers
  expect(remainder(-10, 3)).toBe(2);
  expect(remainder(-5, 2)).toBe(1);
  expect(remainder(-7, 4)).toBe(1);
  // Test with decimal numbers
  expect(remainder(10.5, 3)).toBeCloseTo(1.5);
  expect(remainder(-10.5, 3)).toBeCloseTo(1.5);
});
