import { getBranchConfigOverrideQuery, getEnvironmentConfigOverrideQuery, overrideBranchConfigOverride, overrideEnvironmentConfigOverride, setBranchConfigOverride, setBranchConfigOverrideSource, setEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { branchConfigSchema, environmentConfigSchema, getConfigOverrideErrors, migrateConfigOverride } from "@stackframe/stack-shared/dist/config/schema";
import { adaptSchema, adminAuthTypeSchema, branchConfigSourceSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import * as yup from "yup";

type BranchConfigSourceApi = yup.InferType<typeof branchConfigSourceSchema>;

const levelSchema = yupString().oneOf(["branch", "environment"]).defined();

const levelConfigs = {
  branch: {
    schema: branchConfigSchema,
    migrate: (config: any) => migrateConfigOverride("branch", config),
    get: (options: { projectId: string, branchId: string }) =>
      rawQuery(globalPrismaClient, getBranchConfigOverrideQuery(options)),
    set: async (options: { projectId: string, branchId: string, config: any, source?: BranchConfigSourceApi }) => {
      await setBranchConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        branchConfigOverride: options.config,
      });
      if (options.source) {
        await setBranchConfigOverrideSource({
          projectId: options.projectId,
          branchId: options.branchId,
          source: options.source,
        });
      }
    },
    override: (options: { projectId: string, branchId: string, config: any }) =>
      overrideBranchConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        branchConfigOverrideOverride: options.config,
      }),
    requiresSource: true,
  },
  environment: {
    schema: environmentConfigSchema,
    migrate: (config: any) => migrateConfigOverride("environment", config),
    get: (options: { projectId: string, branchId: string }) =>
      rawQuery(globalPrismaClient, getEnvironmentConfigOverrideQuery(options)),
    set: (options: { projectId: string, branchId: string, config: any, source?: BranchConfigSourceApi }) =>
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
    requiresSource: false,
  },
};

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
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

  return migratedConfig;
}

export const PUT = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: 'Set config override',
    description: 'Replace the config override for a project, branch, and level. For branch level, source is required.',
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
      // Source is required for branch level, optional for environment level
      source: branchConfigSourceSchema.optional(),
    }).defined(),
  }),
  response: writeResponseSchema,
  handler: async (req) => {
    const levelConfig = levelConfigs[req.params.level];
    const parsedConfig = await parseAndValidateConfig(req.body.config_string, levelConfig);

    // Validate that source is provided for branch level
    if (levelConfig.requiresSource && !req.body.source) {
      throw new StatusError(StatusError.BadRequest, 'source is required for branch level config');
    }

    await levelConfig.set({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      config: parsedConfig,
      source: req.body.source as BranchConfigSourceApi,
    });

    return {
      statusCode: 200 as const,
      bodyType: "success" as const,
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    hidden: true,
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

