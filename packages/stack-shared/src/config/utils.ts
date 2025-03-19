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

export function validateConfigOverride(options: {
  configLevel: ConfigLevel,
  configSchema: yup.ObjectSchema<any>,
  configOverride: Config,
}): void {
  const allowedEndConfigLevels = configLevels.slice(configLevels.indexOf(options.configLevel));
  const reason = getInvalidConfigOverrideReason(options.configOverride);
  if (reason) {
    throw new ConfigOverrideValidationError(`Invalid config override:\n${reason}`);
  }
  validateConfigOverrideHelper({
    configLevel: options.configLevel,
    configSchema: options.configSchema,
    configOverride: options.configOverride,
    path: [],
  });
}

function validateConfigOverrideHelper(options: {
  configLevel: ConfigLevel,
  configSchema: yup.Schema<any>,
  configOverride: ConfigValue,
  path: string[],
}): void {
  const configSchemaType = options.configSchema.type;
  if (typeof options.configOverride === 'object') {
    if (configSchemaType === 'object') {
    } else if (configSchemaType === 'tuple') {
    } else {
      throw new ConfigOverrideValidationError(`Invalid config at path ${options.path.join('.')}: expected type ${configSchemaType}, but received an object`);
    }
  }
}

import.meta.vitest?.test("test", async ({ expect }) => {
  validateConfigOverrideHelper({
    configLevel: 'environment',
    configSchema: yupTuple([
      yupObject({
        a: yupString().defined(),
      }),
      yupObject({
        b: yupString().defined(),
      }),
    ]),
    configOverride: {},
    path: [],
  });
});
