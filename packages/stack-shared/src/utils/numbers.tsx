const magnitudes = [
  [1_000_000_000_000_000, "trln"],
  [1_000_000_000_000, "bln"],
  [1_000_000_000, "bn"],
  [1_000_000, "M"],
  [1_000, "k"],
] as const;

export function prettyPrintWithMagnitudes(num: number): string {
  if (typeof num !== "number") throw new Error("Expected a number");
  if (Number.isNaN(num)) return "NaN";
  if (num < 0) return "-" + prettyPrintWithMagnitudes(-num);
  if (!Number.isFinite(num)) return "∞";

  for (const [magnitude, suffix] of magnitudes) {
    if (num >= magnitude) {
      return toFixedMax(num / magnitude, 1) + suffix;
    }
  }
  return toFixedMax(num, 1); // Handle numbers less than 1,000 without suffix.
}
import.meta.vitest?.test("prettyPrintWithMagnitudes", ({ expect }) => {
  // Test different magnitudes
  expect(prettyPrintWithMagnitudes(1000)).toBe("1k");
  expect(prettyPrintWithMagnitudes(1500)).toBe("1.5k");
  expect(prettyPrintWithMagnitudes(1000000)).toBe("1M");
  expect(prettyPrintWithMagnitudes(1500000)).toBe("1.5M");
  expect(prettyPrintWithMagnitudes(1000000000)).toBe("1bn");
  expect(prettyPrintWithMagnitudes(1500000000)).toBe("1.5bn");
  expect(prettyPrintWithMagnitudes(1000000000000)).toBe("1bln");
  expect(prettyPrintWithMagnitudes(1500000000000)).toBe("1.5bln");
  expect(prettyPrintWithMagnitudes(1000000000000000)).toBe("1trln");
  expect(prettyPrintWithMagnitudes(1500000000000000)).toBe("1.5trln");
  // Test small numbers
  expect(prettyPrintWithMagnitudes(100)).toBe("100");
  expect(prettyPrintWithMagnitudes(0)).toBe("0");
  expect(prettyPrintWithMagnitudes(0.5)).toBe("0.5");
  // Test negative numbers
  expect(prettyPrintWithMagnitudes(-1000)).toBe("-1k");
  expect(prettyPrintWithMagnitudes(-1500000)).toBe("-1.5M");
  // Test special cases
  expect(prettyPrintWithMagnitudes(NaN)).toBe("NaN");
  expect(prettyPrintWithMagnitudes(Infinity)).toBe("∞");
  expect(prettyPrintWithMagnitudes(-Infinity)).toBe("-∞");
});

export function toFixedMax(num: number, maxDecimals: number): string {
  return num.toFixed(maxDecimals).replace(/\.?0+$/, "");
}
import.meta.vitest?.test("toFixedMax", ({ expect }) => {
  expect(toFixedMax(1, 2)).toBe("1");
  expect(toFixedMax(1.2, 2)).toBe("1.2");
  expect(toFixedMax(1.23, 2)).toBe("1.23");
  expect(toFixedMax(1.234, 2)).toBe("1.23");
  expect(toFixedMax(1.0, 2)).toBe("1");
  expect(toFixedMax(1.20, 2)).toBe("1.2");
  expect(toFixedMax(0, 2)).toBe("0");
});

export function numberCompare(a: number, b: number): number {
  return Math.sign(a - b);
}
import.meta.vitest?.test("numberCompare", ({ expect }) => {
  expect(numberCompare(1, 2)).toBe(-1);
  expect(numberCompare(2, 1)).toBe(1);
  expect(numberCompare(1, 1)).toBe(0);
  expect(numberCompare(0, 0)).toBe(0);
  expect(numberCompare(-1, -2)).toBe(1);
  expect(numberCompare(-2, -1)).toBe(-1);
  expect(numberCompare(-1, 1)).toBe(-1);
  expect(numberCompare(1, -1)).toBe(1);
});
