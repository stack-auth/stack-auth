import * as yup from "yup";
import { KnownErrors, OAuthProviderConfigJson, ProjectJson, ServerUserJson } from "@stackframe/stack-shared";
import { Prisma, ProxiedOAuthProviderType, StandardOAuthProviderType } from "@prisma/client";
import { prismaClient } from "@/prisma-client";
import { decodeAccessToken } from "./tokens";
import { yupObject, yupString, yupNumber, yupBoolean, yupArray, yupMixed } from "@stackframe/stack-shared/dist/schema-fields";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { EmailConfigJson, SharedProvider, StandardProvider, sharedProviders, standardProviders } from "@stackframe/stack-shared/dist/interface/clientInterface";
import { OAuthProviderUpdateOptions, ProjectUpdateOptions } from "@stackframe/stack-shared/dist/interface/adminInterface";
import { StackAssertionError, StatusError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { fullPermissionInclude, isTeamSystemPermission, listServerPermissionDefinitions, serverPermissionDefinitionJsonFromDbType, serverPermissionDefinitionJsonFromTeamSystemDbType, teamPermissionIdSchema, teamSystemPermissionStringToDBType } from "./permissions";
import { usersCrudHandlers } from "@/app/api/v1/users/crud";
import { CrudHandlerInvocationError } from "@/route-handlers/crud-handler";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";


function toDBSharedProvider(type: SharedProvider): ProxiedOAuthProviderType {
  return ({
    "shared-github": "GITHUB",
    "shared-google": "GOOGLE",
    "shared-facebook": "FACEBOOK",
    "shared-microsoft": "MICROSOFT",
    "shared-spotify": "SPOTIFY",
  } as const)[type];
}

function toDBStandardProvider(type: StandardProvider): StandardOAuthProviderType {
  return ({
    "github": "GITHUB",
    "facebook": "FACEBOOK",
    "google": "GOOGLE",
    "microsoft": "MICROSOFT",
    "spotify": "SPOTIFY",
  } as const)[type];
}

function fromDBSharedProvider(type: ProxiedOAuthProviderType): SharedProvider {
  return ({
    "GITHUB": "shared-github",
    "GOOGLE": "shared-google",
    "FACEBOOK": "shared-facebook",
    "MICROSOFT": "shared-microsoft",
    "SPOTIFY": "shared-spotify",
  } as const)[type];
}

function fromDBStandardProvider(type: StandardOAuthProviderType): StandardProvider {
  return ({
    "GITHUB": "github",
    "FACEBOOK": "facebook",
    "GOOGLE": "google",
    "MICROSOFT": "microsoft",
    "SPOTIFY": "spotify",
  } as const)[type];
}


export const fullProjectInclude = {
  config: {
    include: {
      oauthProviderConfigs: {
        include: {
          proxiedOAuthConfig: true,
          standardOAuthConfig: true,
        },
      },
      emailServiceConfig: {
        include: {
          proxiedEmailServiceConfig: true,
          standardEmailServiceConfig: true,
        },
      },
      permissions: {
        include: fullPermissionInclude,
      },
      domains: true,
    },
  },
  configOverride: true,
  _count: {
    select: {
      users: true, // Count the users related to the project
    },
  },
} as const satisfies Prisma.ProjectInclude;
type FullProjectInclude = typeof fullProjectInclude;
export type ProjectDB = Prisma.ProjectGetPayload<{ include: FullProjectInclude }> & {
  config: {
    oauthProviderConfigs: (Prisma.OAuthProviderConfigGetPayload<
      typeof fullProjectInclude.config.include.oauthProviderConfigs
    >)[],
    emailServiceConfig: Prisma.EmailServiceConfigGetPayload<
      typeof fullProjectInclude.config.include.emailServiceConfig
    > | null,
    domains: Prisma.ProjectDomainGetPayload<
      typeof fullProjectInclude.config.include.domains
    >[],
    permissions: Prisma.PermissionGetPayload<
      typeof fullProjectInclude.config.include.permissions
    >[],
  },
};

export async function whyNotProjectAdmin(projectId: string, adminAccessToken: string): Promise<"unparsable-access-token" | "access-token-expired" | "wrong-project-id" | "not-admin" | null> {
  if (!adminAccessToken) {
    return "unparsable-access-token";
  }

  let decoded;
  try {
    decoded = await decodeAccessToken(adminAccessToken);
  } catch (error) {
    if (error instanceof KnownErrors.AccessTokenExpired) {
      return "access-token-expired";
    }
    console.warn("Failed to decode a user-provided admin access token. This may not be an error (for example, it could happen if the client changed Stack app hosts), but could indicate one.", error);
    return "unparsable-access-token";
  }
  const { userId, projectId: accessTokenProjectId } = decoded;
  if (accessTokenProjectId !== "internal") {
    return "wrong-project-id";
  }

  let user;
  try {
    user = await usersCrudHandlers.adminRead({
      project: await getProject("internal") ?? throwErr("Can't find internal project??"),
      userId,
    });
  } catch (e) {
    if (e instanceof CrudHandlerInvocationError && e.cause instanceof KnownErrors.UserNotFound) {
      // this may happen eg. if the user has a valid access token but has since been deleted
      return "not-admin";
    }
    throw e;
  }

  const allProjects = listProjectIds(user);
  if (!allProjects.includes(projectId)) {
    return "not-admin";
  }

  return null;
}

export async function isProjectAdmin(projectId: string, adminAccessToken: string) {
  return !await whyNotProjectAdmin(projectId, adminAccessToken);
}

function listProjectIds(projectUser: UsersCrud["Admin"]["Read"]) {
  const serverMetadata = projectUser.server_metadata;
  if (typeof serverMetadata !== "object" || !(!serverMetadata || "managedProjectIds" in serverMetadata)) {
    throw new StackAssertionError("Invalid server metadata, did something go wrong?", { serverMetadata });
  }
  const managedProjectIds = serverMetadata?.managedProjectIds ?? [];
  if (!isStringArray(managedProjectIds)) {
    throw new StackAssertionError("Invalid server metadata, did something go wrong? Expected string array", { managedProjectIds });
  }

  return managedProjectIds;
}

export async function listProjects(projectUser: UsersCrud["Admin"]["Read"]): Promise<ProjectJson[]> {
  const managedProjectIds = listProjectIds(projectUser);

  const projects = await prismaClient.project.findMany({
    where: {
      id: {
        in: managedProjectIds,
      },
    },
    include: fullProjectInclude,
  });

  return projects.map(p => projectJsonFromDbType(p));
}

export async function getProject(projectId: string): Promise<ProjectJson | null> {
  const rawProject = await prismaClient.project.findUnique({
    where: { id: projectId },
    include: fullProjectInclude,
  });

  if (!rawProject) {
    return null;
  }

  return projectJsonFromDbType(rawProject);
}

async function _createOAuthConfigUpdateTransactions(
  projectId: string,
  options: ProjectUpdateOptions
) {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
    include: fullProjectInclude,
  });

  if (!project) {
    throw new Error(`Project with id '${projectId}' not found`);
  }

  const transactions = [];
  const oauthProvidersUpdate = options.config?.oauthProviders;
  if (!oauthProvidersUpdate) {
    return [];
  }
  const oldProviders = project.config.oauthProviderConfigs;
  const providerMap = new Map(oldProviders.map((provider) => [
    provider.id, 
    {
      providerUpdate: oauthProvidersUpdate.find((p) => p.id === provider.id) ?? throwErr(`Missing provider update for provider '${provider.id}'`),
      oldProvider: provider,
    }
  ]));

  const newProviders = oauthProvidersUpdate.map((providerUpdate) => ({
    id: providerUpdate.id, 
    update: providerUpdate
  })).filter(({ id }) => !providerMap.has(id));

  // Update existing proxied/standard providers
  for (const [id, { providerUpdate, oldProvider }] of providerMap) {
    // remove existing provider configs
    if (oldProvider.proxiedOAuthConfig) {
      transactions.push(prismaClient.proxiedOAuthProviderConfig.delete({
        where: { projectConfigId_id: { projectConfigId: project.config.id, id } },
      }));
    }

    if (oldProvider.standardOAuthConfig) {
      transactions.push(prismaClient.standardOAuthProviderConfig.delete({
        where: { projectConfigId_id: { projectConfigId: project.config.id, id } },
      }));
    }

    // update provider configs with newly created proxied/standard provider configs
    let providerConfigUpdate;
    if (sharedProviders.includes(providerUpdate.type as SharedProvider)) {
      providerConfigUpdate = {
        proxiedOAuthConfig: {
          create: {
            type: toDBSharedProvider(providerUpdate.type as SharedProvider),
          },
        },
      };

    } else if (standardProviders.includes(providerUpdate.type as StandardProvider)) {
      const typedProviderConfig = providerUpdate as OAuthProviderUpdateOptions & { type: StandardProvider };
      providerConfigUpdate = {
        standardOAuthConfig: {
          create: {
            type: toDBStandardProvider(providerUpdate.type as StandardProvider),
            clientId: typedProviderConfig.clientId,
            clientSecret: typedProviderConfig.clientSecret,
          },
        },
      };
    } else {
      throw new StackAssertionError(`Invalid provider type '${providerUpdate.type}'`, { providerUpdate });
    }

    transactions.push(prismaClient.oAuthProviderConfig.update({
      where: { projectConfigId_id: { projectConfigId: project.config.id, id } },
      data: {
        enabled: providerUpdate.enabled,
        ...providerConfigUpdate,
      },
    }));
  }
    
  // Create new providers
  for (const provider of newProviders) {
    let providerConfigData;
    if (sharedProviders.includes(provider.update.type as SharedProvider)) {
      providerConfigData = {
        proxiedOAuthConfig: {
          create: {
            type: toDBSharedProvider(provider.update.type as SharedProvider),
          },
        },
      };
    } else if (standardProviders.includes(provider.update.type as StandardProvider)) {
      const typedProviderConfig = provider.update as OAuthProviderUpdateOptions & { type: StandardProvider };

      providerConfigData = {
        standardOAuthConfig: {
          create: {
            type: toDBStandardProvider(provider.update.type as StandardProvider),
            clientId: typedProviderConfig.clientId,
            clientSecret: typedProviderConfig.clientSecret,
          },
        },
      };
    } else {
      throw new StackAssertionError(`Invalid provider type '${provider.update.type}'`, { provider });
    }

    transactions.push(prismaClient.oAuthProviderConfig.create({
      data: {
        id: provider.id,
        projectConfigId: project.config.id,
        enabled: provider.update.enabled,
        ...providerConfigData,
      },
    }));
  }
  return transactions;
}

async function _createEmailConfigUpdateTransactions(
  projectId: string,
  options: ProjectUpdateOptions
) {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
    include: fullProjectInclude,
  });

  if (!project) {
    throw new Error(`Project with id '${projectId}' not found`);
  }

  const transactions = [];
  const emailConfig = options.config?.emailConfig;
  if (!emailConfig) {
    return [];
  }

  let emailServiceConfig = project.config.emailServiceConfig;
  if (!emailServiceConfig) {
    emailServiceConfig = await prismaClient.emailServiceConfig.create({
      data: {
        projectConfigId: project.config.id,
      },
      include: {
        proxiedEmailServiceConfig: true,
        standardEmailServiceConfig: true,
      },
    });
  }

  if (emailServiceConfig.proxiedEmailServiceConfig) {
    transactions.push(prismaClient.proxiedEmailServiceConfig.delete({
      where: { projectConfigId: project.config.id },
    }));
  }

  if (emailServiceConfig.standardEmailServiceConfig) {
    transactions.push(prismaClient.standardEmailServiceConfig.delete({
      where: { projectConfigId: project.config.id },
    }));
  }

  switch (emailConfig.type) {
    case "shared": {
      transactions.push(prismaClient.proxiedEmailServiceConfig.create({
        data: {
          projectConfigId: project.config.id,
        },
      }));
      break;
    }
    case "standard": {
      transactions.push(prismaClient.standardEmailServiceConfig.create({
        data: {
          projectConfigId: project.config.id,
          host: emailConfig.host,
          port: emailConfig.port,
          username: emailConfig.username,
          password: emailConfig.password,
          senderEmail: emailConfig.senderEmail,
          senderName: emailConfig.senderName,
        },
      }));
      break;
    }
  }

  return transactions;
}

async function _createDefaultPermissionsUpdateTransactions(
  projectId: string,
  options: ProjectUpdateOptions
) {
  const project = await prismaClient.project.findUnique({
    where: { id: projectId },
    include: fullProjectInclude,
  });

  if (!project) {
    throw new Error(`Project with id '${projectId}' not found`);
  }

  const transactions = [];
  const permissions = await listServerPermissionDefinitions(projectId, { type: 'any-team' });

  const params = [
    {
      optionName: 'teamCreatorDefaultPermissionIds',
      dbName: 'teamCreatorDefaultPermissions',
      dbSystemName: 'teamCreateDefaultSystemPermissions',
    },
    {
      optionName: 'teamMemberDefaultPermissionIds',
      dbName: 'teamMemberDefaultPermissions',
      dbSystemName: 'teamMemberDefaultSystemPermissions',
    },
  ] as const;

  for (const param of params) {
    const creatorPerms = options.config?.[param.optionName];
    if (creatorPerms) {
      if (!creatorPerms.every((id) => permissions.some((perm) => perm.id === id))) {
        throw new StatusError(StatusError.BadRequest, "Invalid team default permission ids");
      }

      const connect = creatorPerms
        .filter(x => !isTeamSystemPermission(x))
        .map((id) => ({
          projectConfigId_queryableId: { 
            projectConfigId: project.config.id, 
            queryableId: id 
          },
        }));
    
      const systemPerms = creatorPerms
        .filter(isTeamSystemPermission)
        .map(teamSystemPermissionStringToDBType);

      transactions.push(prismaClient.projectConfig.update({
        where: { id: project.config.id },
        data: {
          [param.dbName]: { connect },
          [param.dbSystemName]: systemPerms,
        },
      }));
    }
  }

  return transactions;
}

export function projectJsonFromDbType(project: ProjectDB): ProjectJson {
  let emailConfig: EmailConfigJson | undefined;
  const emailServiceConfig = project.config.emailServiceConfig;
  if (emailServiceConfig) {
    if (emailServiceConfig.proxiedEmailServiceConfig) {
      emailConfig = {
        type: "shared",
      };
    }
    if (emailServiceConfig.standardEmailServiceConfig) {
      const standardEmailConfig = emailServiceConfig.standardEmailServiceConfig;
      emailConfig = {
        type: "standard",
        host: standardEmailConfig.host,
        port: standardEmailConfig.port,
        username: standardEmailConfig.username,
        password: standardEmailConfig.password,
        senderEmail: standardEmailConfig.senderEmail,
        senderName: standardEmailConfig.senderName,
      };
    }
  }
  return {
    id: project.id,
    displayName: project.displayName,
    description: project.description ?? undefined,
    createdAtMillis: project.createdAt.getTime(),
    userCount: project._count.users,
    isProductionMode: project.isProductionMode,
    evaluatedConfig: {
      id: project.config.id,
      allowLocalhost: project.config.allowLocalhost,
      credentialEnabled: project.config.credentialEnabled,
      magicLinkEnabled: project.config.magicLinkEnabled,
      createTeamOnSignUp: project.config.createTeamOnSignUp,
      domains: project.config.domains.map((domain) => ({
        domain: domain.domain,
        handlerPath: domain.handlerPath,
      })),
      oauthProviders: project.config.oauthProviderConfigs.flatMap((provider): OAuthProviderConfigJson[] => {
        if (provider.proxiedOAuthConfig) {
          return [{
            id: provider.id,
            enabled: provider.enabled,
            type: fromDBSharedProvider(provider.proxiedOAuthConfig.type),
          }];
        }
        if (provider.standardOAuthConfig) {
          return [{
            id: provider.id,
            enabled: provider.enabled,
            type: fromDBStandardProvider(provider.standardOAuthConfig.type),
            clientId: provider.standardOAuthConfig.clientId,
            clientSecret: provider.standardOAuthConfig.clientSecret,
          }];
        }
        captureError("projectJsonFromDbType", new StackAssertionError(`Exactly one of the provider configs should be set on provider config '${provider.id}' of project '${project.id}'. Ignoring it`, { project }));
        return [];
      }),
      emailConfig,
      teamCreatorDefaultPermissions: project.config.permissions.filter(perm => perm.isDefaultTeamCreatorPermission)
        .map(serverPermissionDefinitionJsonFromDbType)
        .concat(project.config.teamCreateDefaultSystemPermissions.map(serverPermissionDefinitionJsonFromTeamSystemDbType)),
      teamMemberDefaultPermissions: project.config.permissions.filter(perm => perm.isDefaultTeamMemberPermission)
        .map(serverPermissionDefinitionJsonFromDbType)
        .concat(project.config.teamMemberDefaultSystemPermissions.map(serverPermissionDefinitionJsonFromTeamSystemDbType)),
    },
  };
}

function isStringArray(value: any): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function requiredWhenShared<S extends yup.AnyObject>(schema: S): S {
  return schema.when('shared', {
    is: 'false',
    then: (schema: S) => schema.required(),
    otherwise: (schema: S) => schema.optional()
  });
}

const nonRequiredSchemas = {
  description: yupString().optional(),
  isProductionMode: yupBoolean().optional(),
  config: yupObject({
    domains: yupArray(yupObject({
      domain: yupString().required(),
      handlerPath: yupString().required(),
    })).optional().default(undefined),
    oauthProviders: yupArray(
      yupObject({
        id: yupString().required(),
        enabled: yupBoolean().required(),
        type: yupString().required(),
        clientId: yupString().optional(),
        clientSecret: yupString().optional(),
      })
    ).optional().default(undefined),
    credentialEnabled: yupBoolean().optional(),
    magicLinkEnabled: yupBoolean().optional(),
    allowLocalhost: yupBoolean().optional(),
    createTeamOnSignUp: yupBoolean().optional(),
    emailConfig: yupObject({
      type: yupString().oneOf(["shared", "standard"]).required(),
      senderName: requiredWhenShared(yupString()),
      host: requiredWhenShared(yupString()),
      port: requiredWhenShared(yupNumber()),
      username: requiredWhenShared(yupString()),
      password: requiredWhenShared(yupString()),
      senderEmail: requiredWhenShared(yupString().email()),
    }).optional().default(undefined),
    teamCreatorDefaultPermissionIds: yupArray(teamPermissionIdSchema.required()).optional().default(undefined),
    teamMemberDefaultPermissionIds: yupArray(teamPermissionIdSchema.required()).optional().default(undefined),
  }).optional().default(undefined),
};

export const getProjectUpdateSchema = () => yupObject({
  displayName: yupString().optional(),
  ...nonRequiredSchemas,
});

export const getProjectCreateSchema = () => yupObject({
  displayName: yupString().required(),
  ...nonRequiredSchemas,
});

export const projectSchemaToUpdateOptions = (
  update: yup.InferType<ReturnType<typeof getProjectUpdateSchema>>
): ProjectUpdateOptions => {
  return {
    displayName: update.displayName,
    description: update.description,
    isProductionMode: update.isProductionMode,
    config: update.config && {
      domains: update.config.domains,
      allowLocalhost: update.config.allowLocalhost,
      credentialEnabled: update.config.credentialEnabled,
      magicLinkEnabled: update.config.magicLinkEnabled,
      createTeamOnSignUp: update.config.createTeamOnSignUp,
      oauthProviders: update.config.oauthProviders && update.config.oauthProviders.map((provider) => {
        if (sharedProviders.includes(provider.type as SharedProvider)) {
          return {
            id: provider.id,
            enabled: provider.enabled,
            type: provider.type as SharedProvider,
          };
        } else if (standardProviders.includes(provider.type as StandardProvider)) {
          if (!provider.clientId) {
            throw new StatusError(StatusError.BadRequest, "Missing clientId");
          }
          if (!provider.clientSecret) {
            throw new StatusError(StatusError.BadRequest, "Missing clientSecret");
          }
            
          return {
            id: provider.id,
            enabled: provider.enabled,
            type: provider.type as StandardProvider,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
          };
        } else {
          throw new StatusError(StatusError.BadRequest, "Invalid oauth provider type");
        }
      }),
      emailConfig: update.config.emailConfig && (
        update.config.emailConfig.type === "shared" ? {
          type: update.config.emailConfig.type,
        } : {
          type: update.config.emailConfig.type,
          senderName: update.config.emailConfig.senderName!,
          host: update.config.emailConfig.host!,
          port: update.config.emailConfig.port!,
          username: update.config.emailConfig.username!,
          password: update.config.emailConfig.password!,
          senderEmail: update.config.emailConfig.senderEmail!,
        }
      ),
      teamCreatorDefaultPermissionIds: update.config.teamCreatorDefaultPermissionIds,
      teamMemberDefaultPermissionIds: update.config.teamMemberDefaultPermissionIds,
    },
  };
};

export const projectSchemaToCreateOptions = (
  create: yup.InferType<ReturnType<typeof getProjectCreateSchema>>
): ProjectUpdateOptions & { displayName: string } => {
  return {
    ...projectSchemaToUpdateOptions(create),
    displayName: create.displayName,
  };
};
