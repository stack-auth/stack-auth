import * as yup from "yup";
import { yupObject, yupString, yupTuple } from "../schema-fields";
import { Config, ConfigValue, getInvalidConfigOverrideReason } from "./parser";
import { ConfigLevel, configLevels } from "./schema";

export class ConfigOverrideValidationError extends Error {
  constructor(message: string, public readonly details?: Record<string, any>) {
    super(message);
    this.name = 'ConfigOverrideValidationError';
  }
}

export async function validateConfigOverride(options: {
  configLevel: ConfigLevel,
  configSchema: yup.ObjectSchema<any>,
  configOverride: Config,
}): void {
  const allowedEndConfigLevels = configLevels.slice(configLevels.indexOf(options.configLevel));
  const reason = getInvalidConfigOverrideReason(options.configOverride);
  if (reason) {
    throw new ConfigOverrideValidationError(`Invalid config override:\n${reason}`);
  }
  await validateConfigOverrideHelper({
    configLevel: options.configLevel,
    configSchema: options.configSchema,
    configOverride: options.configOverride,
    path: [],
  });
}

function createInvalidPathMessage(path: string[]): string {
  return "Invalid config " + (path.length > 0 ? `at path ${path.join('.')}` : 'at root');
}

async function validateConfigOverrideHelper(options: {
  configLevel: ConfigLevel,
  configSchema: yup.Schema<any>,
  configOverride: ConfigValue,
  path: string[],
}): Promise<void> {
  const configSchemaType = options.configSchema.type;
  switch (typeof options.configOverride) {
    case 'object': {
      if (Array.isArray(options.configOverride)) {
        if (configSchemaType !== 'tuple') {
          throw new ConfigOverrideValidationError(`${createInvalidPathMessage(options.path)}: expected ${configSchemaType}, but received tuple`);
        }

        // Validate each element in the array against the corresponding tuple schema
        const tupleSchema = options.configSchema as yup.TupleSchema<any>;
        const tupleLength = tupleSchema.spec.types.length as any as number;

        for (const [index, value] of options.configOverride.entries()) {
          if (index >= tupleLength) {
            throw new ConfigOverrideValidationError(`${createInvalidPathMessage([...options.path, index.toString()])}: index out of bounds for tuple schema`);
          }

          await validateConfigOverrideHelper({
            configLevel: options.configLevel,
            configSchema: tupleSchema.spec.types[index] as yup.Schema<any>,
            configOverride: value,
            path: [...options.path, index.toString()],
          });
        }
      } else {
        if (configSchemaType !== 'object') {
          throw new ConfigOverrideValidationError(`${createInvalidPathMessage(options.path)}: expected ${configSchemaType}, but received object`);
        }

        for (const [key, value] of Object.entries(options.configOverride as Record<string, ConfigValue>)) {
          const segments = key.split('.');
          const schemaFields = (options.configSchema as yup.ObjectSchema<any>).fields;
          if (!(segments[0] in schemaFields)) {
            throw new ConfigOverrideValidationError(`${createInvalidPathMessage(options.path)}: unexpected key ${segments[0]}`);
          }
          await validateConfigOverrideHelper({
            configLevel: options.configLevel,
            configSchema: schemaFields[segments[0]] as yup.Schema<any>,
            configOverride: segments.length > 1 ? {
              [segments.slice(1).join('.')]: value,
            } : value,
            path: [...options.path, key],
          });
        }
      }
      break;
    }

    case 'string':
    case 'boolean':
    case 'number': {
      if (configSchemaType === typeof options.configOverride) {
        await options.configSchema.validate(options.configOverride);
      } else {
        throw new ConfigOverrideValidationError(`${createInvalidPathMessage(options.path)}: expected ${configSchemaType}, but received ${typeof options.configOverride}`);
      }
      break;
    }

    default: {
      throw new ConfigOverrideValidationError(`${createInvalidPathMessage(options.path)}: unsupported value type ${typeof options.configOverride}`);
    }
  }
}

import.meta.vitest?.test("test", async ({ expect }) => {
  await validateConfigOverrideHelper({
    configLevel: 'environment',
    // configSchema: yupTuple([
    //   yupObject({
    //     a: yupString().defined(),
    //   }),
    //   yupObject({
    //     b: yupString().defined(),
    //   }),
    // ]),
    // configSchema: yupObject({
    //   a: yupString().defined(),
    //   b: yupObject({
    //     c: yupString().defined(),
    //   }),
    // }),
    // configOverride: {
    //   a: 'b',
    //   b: {
    //     c: 'd',
    //   },
    // },
    configSchema: yupTuple([
      yupObject({
        a: yupString().defined(),
      }),
      yupObject({
        b: yupString().defined(),
      }),
    ]),
    configOverride: [
      {
        a: 'b',
      },
      {
        b: 'c',
      },
    ],
    path: [],
  });
});
