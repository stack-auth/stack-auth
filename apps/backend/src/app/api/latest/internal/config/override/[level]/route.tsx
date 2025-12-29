import { getBranchConfigOverrideQuery, getEnvironmentConfigOverrideQuery, overrideBranchConfigOverride, overrideEnvironmentConfigOverride, setBranchConfigOverride, setEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { branchConfigSchema, environmentConfigSchema, getConfigOverrideErrors, migrateConfigOverride } from "@stackframe/stack-shared/dist/config/schema";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import * as yup from "yup";

const levelSchema = yupString().oneOf(["branch", "environment"]).defined();

const levelConfigs = {
  branch: {
    schema: branchConfigSchema,
    migrate: (config: any) => migrateConfigOverride("branch", config),
    get: (options: { projectId: string, branchId: string }) =>
      rawQuery(globalPrismaClient, getBranchConfigOverrideQuery(options)),
    set: (options: { projectId: string, branchId: string, config: any }) =>
      setBranchConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        branchConfigOverride: options.config,
      }),
    override: (options: { projectId: string, branchId: string, config: any }) =>
      overrideBranchConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        branchConfigOverrideOverride: options.config,
      }),
  },
  environment: {
    schema: environmentConfigSchema,
    migrate: (config: any) => migrateConfigOverride("environment", config),
    get: (options: { projectId: string, branchId: string }) =>
      rawQuery(globalPrismaClient, getEnvironmentConfigOverrideQuery(options)),
    set: (options: { projectId: string, branchId: string, config: any }) =>
      setEnvironmentConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        environmentConfigOverride: options.config,
      }),
    override: (options: { projectId: string, branchId: string, config: any }) =>
      overrideEnvironmentConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        environmentConfigOverrideOverride: options.config,
      }),
  },
} as const satisfies Record<string, {
  schema: yup.AnySchema,
  migrate: (config: any) => any,
  get: (options: { projectId: string, branchId: string }) => Promise<any>,
  set: (options: { projectId: string, branchId: string, config: any }) => Promise<void>,
  override: (options: { projectId: string, branchId: string, config: any }) => Promise<void>,
}>;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: 'Get config override',
    description: 'Get the config override for a project, branch, and level',
    tags: ['Config'],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    params: yupObject({
      level: levelSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      config_string: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const levelConfig = levelConfigs[req.params.level];
    const config = await levelConfig.get({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        config_string: JSON.stringify(config),
      },
    };
  },
});

const writeResponseSchema = yupObject({
  statusCode: yupNumber().oneOf([200]).defined(),
  bodyType: yupString().oneOf(["success"]).defined(),
});

async function parseAndValidateConfig(
  configString: string,
  levelConfig: typeof levelConfigs["branch" | "environment"]
) {
  let parsedConfig;
  try {
    parsedConfig = JSON.parse(configString);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new StatusError(StatusError.BadRequest, 'Invalid config JSON');
    }
    throw e;
  }

  const migratedConfig = levelConfig.migrate(parsedConfig);
  const overrideError = await getConfigOverrideErrors(levelConfig.schema, migratedConfig);
  if (overrideError.status === "error") {
    throw new StatusError(StatusError.BadRequest, overrideError.error);
  }

  return parsedConfig;
}

export const PUT = createSmartRouteHandler({
  metadata: {
    summary: 'Set config override',
    description: 'Replace the config override for a project, branch, and level',
    tags: ['Config'],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    params: yupObject({
      level: levelSchema,
    }).defined(),
    body: yupObject({
      config_string: yupString().defined(),
    }).defined(),
  }),
  response: writeResponseSchema,
  handler: async (req) => {
    const levelConfig = levelConfigs[req.params.level];
    const parsedConfig = await parseAndValidateConfig(req.body.config_string, levelConfig);

    await levelConfig.set({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      config: parsedConfig,
    });

    return {
      statusCode: 200 as const,
      bodyType: "success" as const,
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: 'Update config override',
    description: 'Update the config override for a project, branch, and level with a partial override',
    tags: ['Config'],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    params: yupObject({
      level: levelSchema,
    }).defined(),
    body: yupObject({
      config_override_string: yupString().defined(),
    }).defined(),
  }),
  response: writeResponseSchema,
  handler: async (req) => {
    const levelConfig = levelConfigs[req.params.level];
    const parsedConfig = await parseAndValidateConfig(req.body.config_override_string, levelConfig);

    await levelConfig.override({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      config: parsedConfig,
    });

    return {
      statusCode: 200 as const,
      bodyType: "success" as const,
    };
  },
});

