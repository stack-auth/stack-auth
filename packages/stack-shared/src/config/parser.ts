// Check out https://github.com/stack-auth/info/blob/main/eng-handbook/random-thoughts/config-json-format.md for more information on the config format

import * as yup from "yup";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "../schema-fields";
import { StackAssertionError } from "../utils/errors";
import { deleteKey, get, has, set } from "../utils/objects";


type ConfigValue = string | number | boolean | null | ConfigValue[] | Config;
export type Config = {
  [keyOrDotNotation: string]: ConfigValue,
};

type NormalizedConfigValue = string | number | boolean | NormalizedConfigValue[] | NormalizedConfig;
export type NormalizedConfig = {
  [key: string]: NormalizedConfigValue,
};


/**
 * Note that a config can both be valid and not normalizable.
 */
export function isValidConfig(c: unknown): c is Config {
  return getInvalidConfigReason(c) === undefined;
}

function getInvalidConfigReason(c: unknown, options: { configName?: string } = {}): string | undefined {
  const configName = options.configName ?? 'config';
  if (c === null || typeof c !== 'object') return `${configName} must be a non-null object`;
  for (const [key, value] of Object.entries(c)) {
    if (typeof key !== 'string') return `${configName} must have only string keys (found: ${typeof key})`;
    if (!key.match(/^[a-zA-Z0-9_$][a-zA-Z_$0-9\-]*(?:\.[a-zA-Z0-9_$][a-zA-Z_$0-9\-]*)*$/)) return `All keys of ${configName} must consist of only alphanumeric characters, dots, underscores, dollar signs, or hyphens and start with a character other than a hyphen (found: ${key})`;

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

export function normalize(c: Config): NormalizedConfig {
  assertValidConfig(c);

  const countDots = (s: string) => s.match(/\./g)?.length ?? 0;
  const result: NormalizedConfig = {};
  const keysByDepth = Object.keys(c).sort((a, b) => countDots(a) - countDots(b));

  for (const key of keysByDepth) {
    if (key.includes('.')) {
      const [prefix, suffix] = key.split('.', 2);
      const oldValue = get(result, prefix);
      if (typeof oldValue !== 'object') throw new StackAssertionError("Tried to use dot notation on a non-object config value. Maybe this config is not normalizable?", { c, key, oldValue });
      set(oldValue, suffix as any, get(c, key));
      setNormalizedValue(result, prefix, oldValue);
    } else {
      setNormalizedValue(result, key, get(c, key));
    }
  }
  return result;
}

function normalizeValue(value: ConfigValue): NormalizedConfigValue {
  if (value === null) throw new StackAssertionError("Tried to normalize a null value");
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
  })).toEqual({
    a: 9,
    b: 2,
    c: {
      d: 10,
      g: 5,
    },
    h: [11, { j: 12 }, 8],
  });
});

async function _testMergeConfigHelper({ configSchema, defaultConfig, overrideConfig }: { configSchema: yup.AnySchema, defaultConfig: Config, overrideConfig: Config }) {
  const result = normalize(override(defaultConfig, overrideConfig));
  return await configSchema.validate(result);
}

import.meta.vitest?.test("add keys", async ({ expect }) => {
  const config = {};

  const newConfig = await _testMergeConfigHelper({
    configSchema: yupObject({
      b: yupNumber().optional(),
    }),
    defaultConfig: config,
    overrideConfig: { b: 456 },
  });

  expect(newConfig).toEqual({ b: 456 });
});

import.meta.vitest?.test("replace keys", async ({ expect }) => {
  const config = {
    a: 123,
  };

  const newConfig = await _testMergeConfigHelper({
    configSchema: yupObject({
      a: yupNumber().optional(),
    }),
    defaultConfig: config,
    overrideConfig: { a: 456 },
  });

  expect(newConfig).toEqual({ a: 456 });
});

import.meta.vitest?.test("remove keys", async ({ expect }) => {
  const config = {
    a: 123,
  };

  const newConfig = await _testMergeConfigHelper({
    configSchema: yupObject({
      a: yupNumber().optional(),
    }),
    defaultConfig: config,
    overrideConfig: { a: null },
  });

  expect(newConfig).toEqual({});
});

import.meta.vitest?.test("add nested keys", async ({ expect }) => {
  const config = {
    a: {},
  };

  const newConfig = await _testMergeConfigHelper({
    configSchema: yupObject({
      a: yupObject({
        b: yupNumber().optional(),
      }),
    }),
    defaultConfig: config,
    overrideConfig: { "a.b": 456 },
  });

  expect(newConfig).toEqual({ a: { b: 456 } });
});

import.meta.vitest?.test("replace nested keys", async ({ expect }) => {
  const config = {
    a: {
      b: 123,
    },
  };

  const newConfig = await _testMergeConfigHelper({
    configSchema: yupObject({
      a: yupObject({
        b: yupNumber().defined(),
      }),
    }),
    defaultConfig: config,
    overrideConfig: { "a.b": 456 },
  });

  expect(newConfig).toEqual({ a: { b: 456 } });
});

import.meta.vitest?.test("replace nested tuple", async ({ expect }) => {
  const config = {
    a: [123],
  };

  const newConfig = await _testMergeConfigHelper({
    configSchema: yupObject({
      a: yupTuple([yupNumber()]).defined(),
    }),
    defaultConfig: config,
    overrideConfig: { 'a.0': 456 },
  });

  expect(newConfig).toEqual({ a: [456] });
});


const CONFIG_LEVELS = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof CONFIG_LEVELS[number];

// Check if all fields in the schema have startLevel and endLevel metadata
export function validateSchemaLevels(schemaField: any, path: string[] = []): void {
  const meta = schemaField.meta() as { startLevel?: string, endLevel?: string } | undefined;
  const schemaType = schemaField.type;

  // Helper function to check metadata and throw error if missing
  const validateMetadata = () => {
    if (!meta?.startLevel || !meta.endLevel) {
      const pathStr = path.length ? path.join('.') : 'root';
      throw new StackAssertionError(
        `Schema field at path "${pathStr}" is missing required metadata: startLevel and/or endLevel`,
        { path, schemaType }
      );
    }
  };

  // If this field has complete metadata, we don't need to validate further
  if (meta?.startLevel && meta.endLevel) {
    return;
  }

  // For non-root fields without meta, throw an error
  if (path.length > 0) {
    validateMetadata();
  }

  switch (schemaType) {
    case 'object': {
      const objectSchema = schemaField as yup.ObjectSchema<any>;
      // Check each field in the object
      for (const [fieldName, fieldSchema] of Object.entries(objectSchema.fields)) {
        validateSchemaLevels(fieldSchema, [...path, fieldName]);
      }
      break;
    }
    default: {
      // For primitive types, check if they have the required metadata
      validateMetadata();
      break;
    }
  }
}

import.meta.vitest?.test("validates schema levels", ({ expect }) => {
  validateSchemaLevels(yupObject({
    a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    b: yupObject({
      c: yupNumber().optional(),
    }).meta({ startLevel: 'project', endLevel: 'organization' }),
    d: yupTuple([yupObject({
      e: yupNumber().optional(),
    })]).meta({ startLevel: 'project', endLevel: 'organization' }),
  }));
});

import.meta.vitest?.test("fails when schema level is missing", ({ expect }) => {
  expect(() => validateSchemaLevels(yupObject({
    a: yupNumber().optional(),
  }))).toThrow();
});

import.meta.vitest?.test("fails when schema level is missing in nested object", ({ expect }) => {
  expect(() => validateSchemaLevels(yupObject({
    a: yupObject({
      b: yupObject({
        c: yupNumber().optional(),
      }).meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
  }))).toThrow();
});

import.meta.vitest?.test("fails when schema level is missing in nested tuple", ({ expect }) => {
  expect(() => validateSchemaLevels(yupObject({
    a: yupTuple([yupObject({
      b: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    })]),
  }))).toThrow();
});

function validateConfigLevels(options: {
  config: Config,
  configSchema: yup.AnySchema,
  currentLevel: ConfigLevel,
}) {
  const { config, configSchema, currentLevel } = options;

  // Helper function to check if a level is within the valid range
  const isLevelValid = (startLevel: ConfigLevel, endLevel: ConfigLevel) => {
    const levelOrder = CONFIG_LEVELS;
    const startIndex = levelOrder.indexOf(startLevel);
    const endIndex = levelOrder.indexOf(endLevel);
    const currentIndex = levelOrder.indexOf(currentLevel);

    return currentIndex >= startIndex && currentIndex <= endIndex;
  };

  // Helper function to validate level constraints and throw appropriate error
  const validateLevelConstraints = (meta: { startLevel?: ConfigLevel, endLevel?: ConfigLevel } | undefined, path: string[]) => {
    if (meta?.startLevel && meta.endLevel) {
      const dotPath = path.join('.');
      if (dotPath && has(config, dotPath)) {
        if (!isLevelValid(meta.startLevel, meta.endLevel)) {
          throw new StackAssertionError(
            `Field "${dotPath}" cannot be set at level "${currentLevel}". Valid levels are from "${meta.startLevel}" to "${meta.endLevel}".`,
            { path, currentLevel, validRange: `${meta.startLevel} to ${meta.endLevel}` }
          );
        }
      }
    }
  };

  // Recursive function to check if fields in a config are valid for the current level
  const validateField = (schema: any, path: string[] = []) => {
    const meta = schema.meta() as { startLevel?: ConfigLevel, endLevel?: ConfigLevel } | undefined;
    const schemaType = schema.type;

    // If the field has metadata, check if the current level is valid
    validateLevelConstraints(meta, path);

    // Recurse into object fields
    if (schemaType === 'object') {
      const objectSchema = schema as yup.ObjectSchema<any>;
      for (const [fieldName, fieldSchema] of Object.entries(objectSchema.fields)) {
        validateField(fieldSchema, [...path, fieldName]);
      }
    }
    // Recurse into tuple fields
    else if (schemaType === 'tuple') {
      const tupleSchema = schema as yup.TupleSchema<any>;
      // @ts-ignore - accessing private field but it's needed
      const innerSchemas = tupleSchema.innerType?.schema;
      if (Array.isArray(innerSchemas)) {
        innerSchemas.forEach((innerSchema, index) => {
          validateField(innerSchema, [...path, String(index)]);
        });
      }
    }
  };

  // Start validation from the root schema
  validateField(configSchema);

  // Check all paths in the config against the schema
  for (const key of Object.keys(config)) {
    // For dot notation keys, we need to check the parent schema
    const parts = key.split('.');
    let currentSchema = configSchema;
    let isValid = true;
    let invalidPath: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const currentPath = parts.slice(0, i + 1);
      invalidPath = currentPath;

      if (currentSchema.type === 'object') {
        // @ts-ignore - accessing fields property
        const nextSchema = currentSchema.fields?.[part];
        if (!nextSchema) {
          isValid = false;
          break;
        }
        currentSchema = nextSchema;
      } else if (currentSchema.type === 'tuple' && !isNaN(Number(part))) {
        // @ts-ignore - accessing private field
        const innerSchemas = currentSchema.innerType?.schema;
        if (Array.isArray(innerSchemas) && innerSchemas[Number(part)]) {
          currentSchema = innerSchemas[Number(part)];
        } else {
          isValid = false;
          break;
        }
      } else {
        isValid = false;
        break;
      }

      // Check meta at each level
      const meta = currentSchema.meta() as { startLevel?: ConfigLevel, endLevel?: ConfigLevel } | undefined;
      if (i === parts.length - 1) {
        validateLevelConstraints(meta, currentPath);
      }
    }

    if (!isValid) {
      throw new StackAssertionError(
        `Field "${invalidPath.join('.')}" is not defined in the schema but is present in the config.`,
        { path: invalidPath, currentLevel }
      );
    }
  }
}

const _exampleConfigSchema = yupObject({
  a: yupObject({
    b: yupNumber().optional(),
  }).meta({ startLevel: 'project', endLevel: 'organization' }),
  c: yupObject({
    d: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'project' }),
  }).meta({ startLevel: 'project', endLevel: 'environment' }),
  e: yupTuple([yupObject({
    f: yupNumber().optional(),
  })]).meta({ startLevel: 'organization', endLevel: 'organization' }),
});

import.meta.vitest?.test("validate config levels", ({ expect }) => {
  validateConfigLevels({
    config: {},
    configSchema: _exampleConfigSchema,
    currentLevel: 'project',
  });

  validateConfigLevels({
    config: {
      'c.d': 123,
    },
    configSchema: _exampleConfigSchema,
    currentLevel: 'project',
  });

  validateConfigLevels({
    config: {
      'a.b': 123,
    },
    configSchema: _exampleConfigSchema,
    currentLevel: 'environment',
  });

  validateConfigLevels({
    config: {
      e: [{ f: 123 }],
    },
    configSchema: _exampleConfigSchema,
    currentLevel: 'organization',
  });
});

import.meta.vitest?.test("fails when config level is wrong", ({ expect }) => {
  expect(() => validateConfigLevels({
    config: {
      'c.d': 123,
    },
    configSchema: _exampleConfigSchema,
    currentLevel: 'environment',
  })).toThrow();

  expect(() => validateConfigLevels({
    config: {
      'e.0.f': 123,
    },
    configSchema: _exampleConfigSchema,
    currentLevel: 'project',
  })).toThrow();
});

export async function mergeConfigs(options: {
  configSchema: yup.AnySchema,
  overrideConfigs: { level: ConfigLevel | 'default', config: Config }[],
  configName?: string,
}): Promise<Config> {
  const levelOrder = ['default', ...CONFIG_LEVELS];
  const overrideConfigLevels = options.overrideConfigs.map(c => c.level);

  // Check if the override configs are in the correct order
  for (let i = 0; i < overrideConfigLevels.length - 1; i++) {
    const currentLevelIndex = levelOrder.indexOf(overrideConfigLevels[i]);
    const nextLevelIndex = levelOrder.indexOf(overrideConfigLevels[i + 1]);

    if (currentLevelIndex > nextLevelIndex) {
      throw new StackAssertionError(
        `Invalid config order: level "${overrideConfigLevels[i]}" comes after "${overrideConfigLevels[i + 1]}" in the override configs, but should come before according to the defined level order`,
        { levelOrder, overrideConfigLevels }
      );
    }
  }

  // Validate the schema before merging configs
  validateSchemaLevels(options.configSchema);

  for (const { level, config } of options.overrideConfigs) {
    if (level === 'default') {
      continue;
    } else {
      validateConfigLevels({
        config,
        configSchema: options.configSchema,
        currentLevel: level,
      });
    }
  }

  // Merge the configs in order
  let mergedConfig: Config = {};

  for (const { config } of options.overrideConfigs) {
    mergedConfig = override(mergedConfig, config);
  }

  // Normalize the merged config
  const normalizedConfig = normalize(mergedConfig);

  // Validate the final config against the schema
  try {
    return await options.configSchema.validate(normalizedConfig);
  } catch (error: any) {
    throw new StackAssertionError(
      `Invalid config: ${error.message}`,
      { config: normalizedConfig, error }
    );
  }
}

import.meta.vitest?.test("mergeConfigs handles simple and multi-level configurations", async ({ expect }) => {
  // Simple config case
  const simpleConfig = {
    a: 123,
  };

  const simpleResult = await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [{ level: 'default', config: simpleConfig }],
  });

  expect(simpleResult).toEqual({ a: 123 });

  // Multiple configs with different levels
  const defaultConfig = { a: 100, b: "default", d: false };
  const projectConfig = { a: 200, c: [1, 2, 3] };
  const organizationConfig = { b: "org", c: [4, 5], e: { nested: true } };

  const multiLevelResult = await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      b: yupString().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      c: yupArray(yupNumber()).optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      d: yupBoolean().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      e: yupObject({
        nested: yupBoolean().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      }).optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: defaultConfig },
      { level: 'project', config: projectConfig },
      { level: 'organization', config: organizationConfig },
    ],
  });

  // Expecting organization level to override project, which overrides default
  expect(multiLevelResult).toEqual({ a: 200, b: "org", c: [4, 5], d: false, e: { nested: true } });
});

import.meta.vitest?.test("mergeConfigs handles nested objects and dot notation", async ({ expect }) => {
  const defaultConfig = {
    nested: { a: 1, b: 2 },
    top: "value"
  };
  const projectConfig = {
    'nested.b': 3,
    'nested.c': 4,
  };

  const nestedResult = await mergeConfigs({
    configSchema: yupObject({
      nested: yupObject({
        a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
        b: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
        c: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      }).optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      top: yupString().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: defaultConfig },
      { level: 'project', config: projectConfig },
    ],
  });

  // Expecting nested objects to be merged properly
  expect(nestedResult).toEqual({ nested: { a: 1, b: 3, c: 4 }, top: "value" });
});

import.meta.vitest?.test("mergeConfigs respects level boundaries and handles required fields", async ({ expect }) => {
  const defaultConfig = { a: 1, b: 2, c: 3 };
  const projectConfig = { a: 10, b: 20, c: 30 };
  const organizationConfig = { c: 300 };

  const result = await mergeConfigs({
    configSchema: yupObject({
      // Only from project level
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'project' }),
      // From project to environment
      b: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'environment' }),
      // All levels
      c: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      // Required field with default
      d: yupBoolean().defined().default(false).meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: defaultConfig },
      { level: 'project', config: projectConfig },
      { level: 'organization', config: organizationConfig },
    ],
  });

  // Each field should respect its level boundaries, and required fields should have defaults
  expect(result).toEqual({ a: 10, b: 20, c: 300, d: false });

  // Test empty configs case
  const emptyResult = await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      b: yupString().defined().default("default").meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [],
  });

  // Should only include required fields with defaults
  expect(emptyResult).toEqual({ b: "default" });
});

import.meta.vitest?.test("mergeConfigs handles special cases: arrays, nulls, and complex structures", async ({ expect }) => {
  // Arrays case
  const arrayConfig1 = {
    items: [1, 2, 3],
    settings: { enabled: true }
  };
  const arrayConfig2 = {
    items: [4, 5]
  };

  const arrayResult = await mergeConfigs({
    configSchema: yupObject({
      items: yupArray(yupNumber()).optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      settings: yupObject({
        enabled: yupBoolean().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      }).optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: arrayConfig1 },
      { level: 'project', config: arrayConfig2 },
    ],
  });

  // Arrays should be replaced, not merged
  expect(arrayResult).toEqual({ items: [4, 5], settings: { enabled: true } });

  // Null values case
  const nullConfig1 = { a: 1, b: "test" };
  const nullConfig2 = { b: null };

  const nullResult = await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
      b: yupString().nullable().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: nullConfig1 },
      { level: 'project', config: nullConfig2 },
    ],
  });

  // null should be used if allowed
  expect(nullResult).toEqual({ a: 1 });
});

import.meta.vitest?.test("mergeConfigs throws error for invalid config schema", async ({ expect }) => {
  // Test with invalid schema (missing meta data)
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(async () => await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional(), // Missing meta data
    }),
    overrideConfigs: [{ level: 'default', config: { a: 123 } }],
  })).rejects.toThrow();
});

import.meta.vitest?.test("mergeConfigs throws error for invalid config level order", ({ expect }) => {
  // Test with configs in wrong order
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(async () => await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: { a: 100 } },
      { level: 'organization', config: { a: 300 } },
      { level: 'project', config: { a: 200 } }, // Wrong order: organization should come after project
    ],
  })).rejects.toThrow(/Invalid config order/);
});

import.meta.vitest?.test("mergeConfigs throws error for config with invalid level", ({ expect }) => {
  // Test with config at a level not allowed by schema
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(async () => await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'organization', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: { a: 100 } },
      { level: 'project', config: { a: 200 } }, // 'a' not allowed at project level
    ],
  })).rejects.toThrow();
});

import.meta.vitest?.test("mergeConfigs throws error for config with invalid value type", async ({ expect }) => {
  // Test with config value that doesn't match schema type
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(async () => await mergeConfigs({
    configSchema: yupObject({
      a: yupNumber().optional().meta({ startLevel: 'project', endLevel: 'organization' }),
    }),
    overrideConfigs: [
      { level: 'default', config: { a: "not a number" } }, // String instead of number
    ],
  })).rejects.toThrow();
});
