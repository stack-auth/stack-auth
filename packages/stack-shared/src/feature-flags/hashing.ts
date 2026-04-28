// Deterministic synchronous hashing for feature flag bucketing.
//
// MurmurHash3 32-bit (x86 variant). Pure, no IO, identical output server- and client-side.
// Critical: changes here invalidate every sticky-bucketing assignment, so do not modify the algorithm.

function murmur3_32(input: string, seed: number = 0): number {
  const data = new TextEncoder().encode(input);
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h1 = seed >>> 0;
  const len = data.length;
  const nBlocks = len >>> 2;

  for (let i = 0; i < nBlocks; i++) {
    const off = i * 4;
    let k1 =
      (data[off] & 0xff) |
      ((data[off + 1] & 0xff) << 8) |
      ((data[off + 2] & 0xff) << 16) |
      ((data[off + 3] & 0xff) << 24);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  let k1 = 0;
  const tailStart = nBlocks * 4;
  const tailLen = len & 3;
  if (tailLen >= 3) k1 ^= (data[tailStart + 2] & 0xff) << 16;
  if (tailLen >= 2) k1 ^= (data[tailStart + 1] & 0xff) << 8;
  if (tailLen >= 1) {
    k1 ^= data[tailStart] & 0xff;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

const BUCKET_HASH_SEPARATOR = "\x01";

/**
 * Deterministically map (distinctId, salt) to a uniformly-distributed value in [0, 1).
 * The salt should typically be `${flagKey}.${ruleId ?? ""}.${rolloutSeed ?? ""}`, so the
 * same person can land in different buckets for different flags.
 */
export function bucket(distinctId: string, salt: string): number {
  const h = murmur3_32(`${distinctId}${BUCKET_HASH_SEPARATOR}${salt}`);
  return h / 0x1_0000_0000;
}

/**
 * Pick a variant key from a weighted distribution, deterministically based on (distinctId, salt).
 * Variants without a weight count as 0. If all weights are 0 (or missing), returns undefined.
 */
export function weightedVariant(
  distinctId: string,
  salt: string,
  variants: ReadonlyArray<{ key: string, weight?: number }>,
): string | undefined {
  let total = 0;
  for (const v of variants) total += v.weight ?? 0;
  if (total <= 0) return undefined;
  const target = bucket(distinctId, salt) * total;
  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight ?? 0;
    if (target < cumulative) return v.key;
  }
  return variants[variants.length - 1].key;
}

/** Exposed for tests. */
export const _internal = { murmur3_32 };


import.meta.vitest?.test("murmur3_32 is deterministic", ({ expect }) => {
  expect(murmur3_32("")).toEqual(murmur3_32(""));
  expect(murmur3_32("hello")).toEqual(murmur3_32("hello"));
  expect(murmur3_32("hello") === murmur3_32("world")).toBe(false);
});

import.meta.vitest?.test("murmur3_32 matches reference vectors", ({ expect }) => {
  // Reference values from MurmurHash3_x86_32 with seed=0; computed once and snapshotted to guard
  // against accidental regressions in the implementation.
  expect(murmur3_32("")).toEqual(0);
  expect(murmur3_32("a")).toEqual(0x3c2569b2);
  expect(murmur3_32("abc")).toEqual(0xb3dd93fa);
  expect(murmur3_32("abcd")).toEqual(0x43ed676a);
  expect(murmur3_32("Hello, world!")).toEqual(0xc0363e43);
});

import.meta.vitest?.test("bucket returns values in [0,1)", ({ expect }) => {
  for (let i = 0; i < 1000; i++) {
    const b = bucket(`user-${i}`, "flag-key");
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(1);
  }
});

import.meta.vitest?.test("bucket is roughly uniformly distributed (±5% over 200k samples)", ({ expect }) => {
  // Loose bound — ~5σ of binomial spread for n/buckets = 20k. Tighter bounds occasionally fail
  // for honest reasons (ordinary statistical variance), so we keep this as a smoke test for gross
  // bias rather than a strict uniformity proof.
  const buckets = 10;
  const counts = new Array(buckets).fill(0);
  const n = 200_000;
  for (let i = 0; i < n; i++) {
    const b = bucket(`distinct-${i}`, "uniform-test");
    counts[Math.floor(b * buckets)]++;
  }
  const expected = n / buckets;
  for (const c of counts) {
    expect(Math.abs(c - expected) / expected).toBeLessThan(0.05);
  }
});

import.meta.vitest?.test("weightedVariant respects weights (±1% over 100k)", ({ expect }) => {
  const variants = [
    { key: "a", weight: 0.7 },
    { key: "b", weight: 0.3 },
  ];
  const counts: Record<string, number> = { a: 0, b: 0 };
  const n = 100_000;
  for (let i = 0; i < n; i++) {
    const v = weightedVariant(`u-${i}`, "salt", variants);
    counts[v!]++;
  }
  expect(Math.abs(counts.a / n - 0.7)).toBeLessThan(0.01);
  expect(Math.abs(counts.b / n - 0.3)).toBeLessThan(0.01);
});

import.meta.vitest?.test("weightedVariant returns undefined when total weight is 0", ({ expect }) => {
  expect(weightedVariant("u", "s", [{ key: "a" }, { key: "b" }])).toBeUndefined();
  expect(weightedVariant("u", "s", [{ key: "a", weight: 0 }])).toBeUndefined();
});
