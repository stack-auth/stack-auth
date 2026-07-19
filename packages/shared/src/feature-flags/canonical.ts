import { murmur3_32 } from "./hashing";
import type { FeatureFlagsBootstrap, FeatureFlagsConfig } from "./types";

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, nestedValue]) => nestedValue !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalJson(nestedValue)}`)
    .join(",")}}`;
}

export function getFeatureFlagsConfigVersion(config: FeatureFlagsConfig): string {
  return murmur3_32(canonicalJson(config)).toString(16).padStart(8, "0");
}

export function createFeatureFlagsBootstrap(config: FeatureFlagsConfig): FeatureFlagsBootstrap {
  return {
    config,
    flagIdsByKey: Object.fromEntries(
      Object.entries(config.flags ?? {})
        .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1]?.key !== undefined)
        .map(([flagId, flag]) => [flag.key ?? flagId, flagId]),
    ),
    configVersion: getFeatureFlagsConfigVersion(config),
  };
}

import.meta.vitest?.test("canonical versions ignore record insertion order", ({ expect }) => {
  const left: FeatureFlagsConfig = { flags: { a: { key: "a" }, b: { key: "b" } } };
  const right: FeatureFlagsConfig = { flags: { b: { key: "b" }, a: { key: "a" } } };
  expect(getFeatureFlagsConfigVersion(left)).toBe(getFeatureFlagsConfigVersion(right));
});
