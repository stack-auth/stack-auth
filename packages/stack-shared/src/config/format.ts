// see https://github.com/stack-auth/info/blob/main/eng-handbook/random-thoughts/config-json-format.md

import { StackAssertionError } from "../utils/errors";
import { deleteKey, get, has, set } from "../utils/objects";


export type ConfigValue = string | number | boolean | null | ConfigValue[] | Config;
export type Config = {
  [keyOrDotNotation: string]: ConfigValue,
};

export type NormalizedConfigValue = string | number | boolean | NormalizedConfigValue[] | NormalizedConfig;
export type NormalizedConfig = {
  [key: string]: NormalizedConfigValue,
};

export type _NormalizesTo<N> = N extends object ? (
  & Config
  & { [K in keyof N]?: _NormalizesTo<N[K]> | null }
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
    if (typeof key !== 'string') return `${configName} must have only string keys (found: ${typeof key})`;
    if (!key.match(/^[a-zA-Z0-9_:$][a-zA-Z_:$0-9\-]*(?:\.[a-zA-Z0-9_:$][a-zA-Z_:$0-9\-]*)*$/)) return `All keys of ${configName} must consist of only alphanumeric characters, dots, underscores, dollar signs, or hyphens and start with a character other than a hyphen (found: ${key})`;

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
          const reason = getInvalidConfigValueReason(v, { valueName: `${valueName}[${index}]` });
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
  for (const key of Object.keys(c2)) {
    result = Object.fromEntries(
      Object.entries(result).filter(([k]) => k !== key && !k.startsWith(key + '.'))
    );
  }

  return {
    ...result,
    ...c2,
  };
}

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
      },
      {
        a: 9,
        "c.d": 10,
        "c.e": null,
        "h.0": 11,
        "h.1": {
          j: 12,
        },
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
  });
});

type NormalizeOptions = {
  /**
   * What to do if a dot notation is used on null.
   *
   * - "throw" (default): Throw an error. This is the safest option, and you should return this to the user if they
   *   attempt to save a config which you know is invalid given the current set of overloads.
   * - "ignore": Ignore the dot notation field. This is useful for applying the config, as we don't want to error out
   *   if a base config has changed to delete a value that was overridden in another config. Note that you should
   *   still show a warning to the user, and notify them to update their config.
   */
  onDotIntoNull?: "throw" | "ignore",
}

export class NormalizationError extends Error {
  constructor(...args: ConstructorParameters<typeof Error>) {
    super(...args);
  }
}
NormalizationError.prototype.name = "NormalizationError";

export function normalize(c: Config, options: NormalizeOptions = {}): NormalizedConfig {
  assertValidConfig(c);
  const onDotIntoNull = options.onDotIntoNull ?? "throw";

  const countDots = (s: string) => s.match(/\./g)?.length ?? 0;
  const result: NormalizedConfig = {};
  const keysByDepth = Object.keys(c).sort((a, b) => countDots(a) - countDots(b));

  outer: for (const key of keysByDepth) {
    const keySegmentsWithoutLast = key.split('.');
    const last = keySegmentsWithoutLast.pop();
    if (!last) {
      throw new NormalizationError(`Tried to normalize ${JSON.stringify(key)}, but it doesn't contain any dots. Maybe this config is not normalizable?`);
    }

    let current: NormalizedConfig = result;
    for (const keySegment of keySegmentsWithoutLast) {
      if (!has(current, keySegment)) {
        switch (onDotIntoNull) {
          case "throw": {
            throw new NormalizationError(`Tried to use dot notation to access ${JSON.stringify(key)}, but ${JSON.stringify(keySegment)} doesn't exist on the object (or is null). Maybe this config is not normalizable?`);
          }
          case "ignore": {
            continue outer;
          }
        }
      }
      const value = get(current, keySegment);
      if (typeof value !== 'object') {
        throw new NormalizationError(`Tried to use dot notation to access ${JSON.stringify(key)}, but ${JSON.stringify(keySegment)} is not an object. Maybe this config is not normalizable?`);
      }
      current = value as NormalizedConfig;
    }
    setNormalizedValue(current, last, get(c, key));
  }
  return result;
}

function normalizeValue(value: ConfigValue): NormalizedConfigValue {
  if (value === null) throw new NormalizationError("Tried to normalize a null value");
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') return normalize(value);
  return value;
}

function setNormalizedValue(result: NormalizedConfig, key: string, value: ConfigValue) {
  if (value === null) {
    if (has(result, key)) {
      deleteKey(result, key);
    }
  } else {
    set(result, key, normalizeValue(value));
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
  })).toEqual({
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
  })).toThrow(`Tried to use dot notation to access "b.c", but "b" doesn't exist on the object (or is null). Maybe this config is not normalizable?`);
  expect(() => normalize({
    b: null,
    "b.c": 2,
  })).toThrow(`Tried to use dot notation to access "b.c", but "b" doesn't exist on the object (or is null). Maybe this config is not normalizable?`);
  expect(normalize({
    "b.c": 2,
  }, { onDotIntoNull: "ignore" })).toEqual({});

  // dotting into non-object
  expect(() => normalize({
    b: 1,
    "b.c": 2,
  })).toThrow(`Tried to use dot notation to access "b.c", but "b" is not an object. Maybe this config is not normalizable?`);
});
