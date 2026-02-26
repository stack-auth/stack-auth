import {
  getBranchConfigOverrideQuery,
  getEnvironmentConfigOverrideQuery,
  getProjectConfigOverrideQuery,
  overrideBranchConfigOverride,
  overrideEnvironmentConfigOverride,
  overrideProjectConfigOverride,
  setBranchConfigOverride,
  setBranchConfigOverrideSource,
  setEnvironmentConfigOverride,
  setProjectConfigOverride,
  validateBranchConfigOverride,
  validateEnvironmentConfigOverride,
} from "@/lib/config";
import { enqueueExternalDbSync } from "@/lib/external-db-sync-queue";
import { LOCAL_EMULATOR_ENV_CONFIG_BLOCKED_MESSAGE, isLocalEmulatorProject } from "@/lib/local-emulator";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { branchConfigSchema, environmentConfigSchema, getConfigOverrideErrors, migrateConfigOverride, projectConfigSchema } from "@stackframe/stack-shared/dist/config/schema";
import { adaptSchema, adminAuthTypeSchema, branchConfigSourceSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import * as yup from "yup";
type BranchConfigSourceApi = yup.InferType<typeof branchConfigSourceSchema>;

const levelSchema = yupString().oneOf(["project", "branch", "environment"]).defined();

function shouldEnqueueExternalDbSync(config: unknown): boolean {
  if (!config || typeof config !== "object") return false;
  const configRecord = config as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(configRecord, "dbSync.externalDatabases")) {
    return true;
  }
  const dbSync = configRecord.dbSync;
  if (dbSync && typeof dbSync === "object") {
    return Object.prototype.hasOwnProperty.call(dbSync as Record<string, unknown>, "externalDatabases");
  }
  return false;
}

const levelConfigs = {
  project: {
    schema: projectConfigSchema,
    migrate: (config: any) => migrateConfigOverride("project", config),
    get: (options: { projectId: string, branchId: string }) =>
      rawQuery(globalPrismaClient, getProjectConfigOverrideQuery({ projectId: options.projectId })),
    set: async (options: { projectId: string, branchId: string, config: any, source?: BranchConfigSourceApi }) => {
      await setProjectConfigOverride({
        projectId: options.projectId,
        projectConfigOverride: options.config,
      });
    },
    override: (options: { projectId: string, branchId: string, config: any }) =>
      overrideProjectConfigOverride({
        projectId: options.projectId,
        projectConfigOverrideOverride: options.config,
      }),
    requiresSource: false,
  },
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
    validate: (options: { projectId: string, branchId: string, config: any }) =>
      validateBranchConfigOverride({
        projectId: options.projectId,
        branchConfigOverride: options.config,
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
    validate: (options: { projectId: string, branchId: string, config: any }) =>
      validateEnvironmentConfigOverride({
        projectId: options.projectId,
        branchId: options.branchId,
        environmentConfigOverride: options.config,
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
  levelConfig: typeof levelConfigs["branch" | "environment" | "project"]
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

async function warnOnValidationFailure(
  levelConfig: typeof levelConfigs[keyof typeof levelConfigs],
  options: { projectId: string, branchId: string, config: any },
) {
  if (!("validate" in levelConfig)) return;
  try {
    const validationResult = await levelConfig.validate(options);
    if (validationResult.status === "error") {
      captureError("config-override-validation-warning", `Config override validation warning for project ${options.projectId} (this may not be a logic error, but rather a client/implementation issue — e.g. dot notation into non-existent record entries): ${validationResult.error}`);
    }
  } catch (e) {
    captureError("config-override-validation-check-failed", e);
  }
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
    if (req.params.level === "environment" && await isLocalEmulatorProject(req.auth.tenancy.project.id)) {
      throw new StatusError(StatusError.BadRequest, LOCAL_EMULATOR_ENV_CONFIG_BLOCKED_MESSAGE);
    }

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

    await warnOnValidationFailure(levelConfig, {
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      config: parsedConfig,
    });

    if (req.params.level === "environment" && shouldEnqueueExternalDbSync(parsedConfig)) {
      await enqueueExternalDbSync(req.auth.tenancy.id);
    }

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
    if (req.params.level === "environment" && await isLocalEmulatorProject(req.auth.tenancy.project.id)) {
      throw new StatusError(StatusError.BadRequest, LOCAL_EMULATOR_ENV_CONFIG_BLOCKED_MESSAGE);
    }

    const levelConfig = levelConfigs[req.params.level];
    const parsedConfig = await parseAndValidateConfig(req.body.config_override_string, levelConfig);

    await levelConfig.override({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      config: parsedConfig,
    });

    await warnOnValidationFailure(levelConfig, {
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      config: parsedConfig,
    });

    if (req.params.level === "environment" && shouldEnqueueExternalDbSync(parsedConfig)) {
      await enqueueExternalDbSync(req.auth.tenancy.id);
    }

    return {
      statusCode: 200 as const,
      bodyType: "success" as const,
    };
  },
});
