// see https://github.com/stack-auth/info/blob/main/eng-handbook/random-thoughts/config-json-format.md

import { StackAssertionError, throwErr } from "../utils/errors";
import { deleteKey, filterUndefined, get, hasAndNotUndefined, set } from "../utils/objects";
import { OptionalKeys, RequiredKeys } from "../utils/types";


export type ConfigValue = string | number | boolean | null | ConfigValue[] | Config;
export type Config = {
  [keyOrDotNotation: string]: ConfigValue | undefined,  // must support undefined for optional values
};

export type NormalizedConfigValue = string | number | boolean | NormalizedConfig | NormalizedConfigValue[];
export type NormalizedConfig = {
  [key: string]: NormalizedConfigValue | undefined,  // must support undefined for optional values
};

export type _NormalizesTo<N> = N extends object ? (
  & Config
  & { [K in OptionalKeys<N>]?: _NormalizesTo<N[K]> | null }
  & { [K in RequiredKeys<N>]: undefined extends N[K] ? _NormalizesTo<N[K]> | null : _NormalizesTo<N[K]> }
  & { [K in `${string}.${string}`]: ConfigValue }
) : N;
export type NormalizesTo<N extends NormalizedConfig> = _NormalizesTo<N>;

/**
 * Note that a config can both be valid and not normalizable.
 */
export function isValidConfig(c: unknown): c is Config {
  return getInvalidConfigReason(c) === undefined;
}

export function getInvalidConfigReason(c: unknown, options: { configName?: string } = {}): string | undefined {
  const configName = options.configName ?? 'config';
  if (c === null || typeof c !== 'object') return `${configName} must be a non-null object`;
  for (const [key, value] of Object.entries(c)) {
    if (value === undefined) continue;
    if (typeof key !== 'string') return `${configName} must have only string keys (found: ${typeof key})`;
    if (!key.match(/^[a-zA-Z0-9_:$][a-zA-Z_:$0-9\-]*(?:\.[a-zA-Z0-9_:$][a-zA-Z_:$0-9\-]*)*$/)) return `All keys of ${configName} must consist of only alphanumeric characters, dots, underscores, colons, dollar signs, or hyphens and start with a character other than a hyphen (found: ${key})`;

    const entryName = `${configName}.${key}`;
    const reason = getInvalidConfigValueReason(value, { valueName: entryName });
    if (reason) return reason;
  }
  return undefined;
}

function getInvalidConfigValueReason(value: unknown, options: { valueName?: string } = {}): string | undefined {
  const valueName = options.valueName ?? 'value';
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean': {
      break;
    }
    case 'object': {
      if (value === null) {
        break;
      } else if (Array.isArray(value)) {
        for (const [index, v] of value.entries()) {
          const elementValueName = `${valueName}[${index}]`;
          if (v === null) return `${elementValueName} is null; tuple elements cannot be null`;
          const reason = getInvalidConfigValueReason(v, { valueName: elementValueName });
          if (reason) return reason;
        }
      } else {
        const reason = getInvalidConfigReason(value, { configName: valueName });
        if (reason) return reason;
      }
      break;
    }
    default: {
      return `${valueName} has an invalid value type ${typeof value} (value: ${value})`;
    }
  }
  return undefined;
}

export function assertValidConfig(c: unknown) {
  const reason = getInvalidConfigReason(c);
  if (reason) throw new StackAssertionError(`Invalid config: ${reason}`, { c });
}

export function override(c1: Config, ...configs: Config[]) {
  if (configs.length === 0) return c1;
  if (configs.length > 1) return override(override(c1, configs[0]), ...configs.slice(1));
  const c2 = configs[0];

  assertValidConfig(c1);
  assertValidConfig(c2);

  let result = c1;
  for (const key of Object.keys(filterUndefined(c2))) {
    result = Object.fromEntries(
      Object.entries(result).filter(([k]) => k !== key && !k.startsWith(key + '.'))
    );
  }

  return {
    ...result,
    ...filterUndefined(c2),
  };
}

/**
 * Removes keys from a config override, using the same nested key logic as the `override` function.
 * Resetting key "a.b" also resets "a.b.c" (and any other descendants).
 * Handles both flat dot-notation keys and nested object keys.
 */
export function removeKeysFromConfig(config: Config, keysToRemove: string[]): Config {
  if (keysToRemove.length === 0) return config;

  const result: Config = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;

    // Check if this flat key matches or is a child of any key to remove (same logic as override)
    const shouldRemove = keysToRemove.some(k => key === k || key.startsWith(k + '.'));
    if (shouldRemove) continue;

    // Check if any key to remove is a descendant of this key (meaning it's nested inside this value)
    const childKeysToRemove = keysToRemove
      .filter(k => k.startsWith(key + '.'))
      .map(k => k.slice(key.length + 1));

    if (childKeysToRemove.length > 0 && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const cleaned = removeKeysFromConfig(value as Config, childKeysToRemove);
      if (Object.keys(cleaned).length > 0) {
        result[key] = cleaned;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

import.meta.vitest?.test("removeKeysFromConfig(...)", ({ expect }) => {
  // Basic flat key removal
  expect(removeKeysFromConfig({ a: 1, b: 2 }, ["a"])).toEqual({ b: 2 });
  expect(removeKeysFromConfig({ "a.b": 1, "a.c": 2, d: 3 }, ["a.b"])).toEqual({ "a.c": 2, d: 3 });

  // Removing a parent removes children (flat keys)
  expect(removeKeysFromConfig({ "a.b": 1, "a.b.c": 2, "a.d": 3 }, ["a.b"])).toEqual({ "a.d": 3 });
  expect(removeKeysFromConfig({ "a.b": 1, "a.c": 2, "a.d": 3 }, ["a"])).toEqual({});
  expect(removeKeysFromConfig({ "teams.allowClientTeamCreation": true, "teams.createPersonalTeamOnSignUp": true }, ["teams"])).toEqual({});

  // Nested object key removal
  expect(removeKeysFromConfig({ teams: { allowClientTeamCreation: true, createPersonalTeamOnSignUp: true } }, ["teams.allowClientTeamCreation"])).toEqual({ teams: { createPersonalTeamOnSignUp: true } });
  expect(removeKeysFromConfig({ teams: { allowClientTeamCreation: true } }, ["teams.allowClientTeamCreation"])).toEqual({});
  expect(removeKeysFromConfig({ teams: { allowClientTeamCreation: true, createPersonalTeamOnSignUp: true } }, ["teams"])).toEqual({});
  expect(removeKeysFromConfig({ a: { b: { c: 1, d: 2 } } }, ["a.b.c"])).toEqual({ a: { b: { d: 2 } } });

  // Mixed flat and nested
  expect(removeKeysFromConfig({ "teams.allowClientTeamCreation": true, teams: { createPersonalTeamOnSignUp: true } }, ["teams.allowClientTeamCreation"])).toEqual({ teams: { createPersonalTeamOnSignUp: true } });
  expect(removeKeysFromConfig({ "teams.allowClientTeamCreation": true, teams: { createPersonalTeamOnSignUp: true } }, ["teams"])).toEqual({});

  // Nested with dot-notation inner keys
  expect(removeKeysFromConfig({ teams: { "a.b": 1 } }, ["teams.a.b"])).toEqual({});
  expect(removeKeysFromConfig({ teams: { "a.b.c": 1 } }, ["teams.a.b"])).toEqual({});

  // No keys to remove
  expect(removeKeysFromConfig({ a: 1, b: 2 }, [])).toEqual({ a: 1, b: 2 });

  // Key not present (no-op)
  expect(removeKeysFromConfig({ a: 1, b: 2 }, ["c"])).toEqual({ a: 1, b: 2 });
  expect(removeKeysFromConfig({ a: 1, b: 2 }, ["a.b"])).toEqual({ a: 1, b: 2 });

  // Multiple keys to remove
  expect(removeKeysFromConfig({ "a.b": 1, "c.d": 2, "e.f": 3 }, ["a.b", "e.f"])).toEqual({ "c.d": 2 });
  expect(removeKeysFromConfig({ a: { b: 1 }, c: { d: 2 } }, ["a.b", "c.d"])).toEqual({});

  // Removing non-object values with nested key path (no-op for non-objects)
  expect(removeKeysFromConfig({ a: "string" }, ["a.b"])).toEqual({ a: "string" });
  expect(removeKeysFromConfig({ a: 123 }, ["a.b"])).toEqual({ a: 123 });
  expect(removeKeysFromConfig({ a: null }, ["a.b"])).toEqual({ a: null });

  // Array values are preserved (not recursed into)
  expect(removeKeysFromConfig({ a: [1, 2, 3] }, ["a.0"])).toEqual({ a: [1, 2, 3] });
});

import.meta.vitest?.test("override(...)", ({ expect }) => {
  expect(
    override(
      {
        a: 1,
        b: 2,
        "c.d": 3,
        "c.e.f": 4,
        "c.g": 5,
        h: [6, { i: 7 }, 8],
        k: 123,
        l: undefined,
      },
      {
        a: 9,
        "c.d": 10,
        "c.e": null,
        "h.0": 11,
        "h.1": {
          j: 12,
        },
        k: undefined,
      },
    )
  ).toEqual({
    a: 9,
    b: 2,
    "c.d": 10,
    "c.e": null,
    "c.g": 5,
    h: [6, { i: 7 }, 8],
    "h.0": 11,
    "h.1": {
      j: 12,
    },
    k: 123,
    l: undefined,
  });
});

type NormalizeOptions = {
  /**
   * What to do if a dot notation is used on a value that is not an object.
   *
   * - "throw" (default): Throw an error.
   * - "ignore": Ignore the dot notation field.
   */
  onDotIntoNonObject?: "throw" | "ignore",
  /**
   * What to do if a dot notation is used on a value that is null.
   *
   * - "like-non-object"  (default): Treat it like a non-object. See `onDotIntoNonObject`.
   * - "throw": Throw an error.
   * - "ignore": Ignore the dot notation field.
   * - "empty-object": Set the value to an empty object.
   */
  onDotIntoNull?: "like-non-object" | "throw" | "ignore" | "empty-object",
}

export class NormalizationError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args);
  }
}
NormalizationError.prototype.name = "NormalizationError";

export function isNormalized(c: Config): c is NormalizedConfig {
  assertValidConfig(c);
  for (const [key, value] of Object.entries(c)) {
    if (value === undefined) continue;
    if (key.includes('.')) return false;
    if (value === null) return false;
  }
  return true;
}

export function assertNormalized(c: Config): asserts c is NormalizedConfig {
  assertValidConfig(c);
  if (!isNormalized(c)) throw new StackAssertionError(`Config is not normalized: ${JSON.stringify(c)}`);
}

export function normalize(c: Config, options: NormalizeOptions = {}): NormalizedConfig {
  assertValidConfig(c);
  const onDotIntoNonObject = options.onDotIntoNonObject ?? "throw";
  const onDotIntoNull = options.onDotIntoNull ?? "like-non-object";

  const countDots = (s: string) => s.match(/\./g)?.length ?? 0;
  const result: NormalizedConfig = {};
  const keysByDepth = Object.keys(c).sort((a, b) => countDots(a) - countDots(b));

  outer: for (const key of keysByDepth) {
    const keySegmentsWithoutLast = key.split('.');
    const last = keySegmentsWithoutLast.pop() ?? throwErr('split returns empty array?');
    const value = get(c, key);
    if (value === undefined) continue;

    let current: NormalizedConfig = result;
    for (const keySegment of keySegmentsWithoutLast) {
      if (!hasAndNotUndefined(current, keySegment)) {
        switch (onDotIntoNull === "like-non-object" ? onDotIntoNonObject : onDotIntoNull) {
          case "throw": {
            throw new NormalizationError(`Tried to use dot notation to access ${JSON.stringify(key)}, but ${JSON.stringify(keySegment)} doesn't exist on the object (or is null).`);
          }
          case "ignore": {
            continue outer;
          }
          case "empty-object": {
            set(current, keySegment, {});
            break;
          }
        }
      }
      const value = get(current, keySegment);
      if (typeof value !== 'object') {
        switch (onDotIntoNonObject) {
          case "throw": {
            throw new NormalizationError(`Tried to use dot notation to access ${JSON.stringify(key)}, but ${JSON.stringify(keySegment)} is not an object.`);
          }
          case "ignore": {
            continue outer;
          }
        }
      }
      current = value as NormalizedConfig;
    }
    setNormalizedValue(current, last, value, options);
  }
  return result;
}

function normalizeValue(value: ConfigValue, options: NormalizeOptions): NormalizedConfigValue {
  if (value === null) throw new NormalizationError("Tried to normalize a null value");
  if (Array.isArray(value)) return value.map(v => normalizeValue(v, options));
  if (typeof value === 'object') return normalize(value, options);
  return value;
}

function setNormalizedValue(result: NormalizedConfig, key: string, value: ConfigValue, options: NormalizeOptions) {
  if (value === null) {
    if (hasAndNotUndefined(result, key)) {
      deleteKey(result, key);
    }
  } else {
    set(result, key, normalizeValue(value, options));
  }
}

import.meta.vitest?.test("normalize(...)", ({ expect }) => {
  expect(normalize({
    a: 9,
    b: 2,
    c: {},
    "c.d": 10,
    "c.e": null,
    "c.g": 5,
    h: [6, { i: 7 }, 8],
    "h.0": 11,
    "h.1": {
      j: 12,
    },
    k: { l: {} },
    "k.l.m": 13,
    n: undefined,
  }, { onDotIntoNonObject: "ignore" })).toEqual({
    a: 9,
    b: 2,
    c: {
      d: 10,
      g: 5,
    },
    h: [11, { j: 12 }, 8],
    k: { l: { m: 13 } },
  });

  // dotting into null
  expect(() => normalize({
    "b.c": 2,
  }, { onDotIntoNonObject: "throw" })).toThrow(`Tried to use dot notation to access "b.c", but "b" doesn't exist on the object (or is null)`);
  expect(() => normalize({
    b: null,
    "b.c": 2,
  }, { onDotIntoNonObject: "throw" })).toThrow(`Tried to use dot notation to access "b.c", but "b" doesn't exist on the object (or is null)`);
  expect(normalize({
    "b.c": 2,
  }, { onDotIntoNonObject: "ignore" })).toEqual({});

  // dotting into non-object
  expect(() => normalize({
    b: 1,
    "b.c": 2,
  }, { onDotIntoNonObject: "throw" })).toThrow(`Tried to use dot notation to access "b.c", but "b" is not an object`);
  expect(normalize({
    b: 1,
    "b.c": 2,
  }, { onDotIntoNonObject: "ignore" })).toEqual({ b: 1 });
});
