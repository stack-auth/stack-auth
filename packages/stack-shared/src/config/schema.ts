import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { NormalizesTo } from "./format";

export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;

export const baseConfig = {
  // default values belong here
  project: {

  },
  team: {
    createTeamOnSignUp: false,
    clientTeamCreationEnabled: false,
    defaultCreatorTeamPermissions: {},
    defaultMemberTeamPermissions: {},
    teamPermissionDefinitions: {},
  },
  user: {
    clientUserDeletionEnabled: false,
    signUpEnabled: true,
    defaultProjectPermissions: {},
    userPermissionDefinitions: {},
  },
  domain: {
    allowLocalhost: true,
  },
  auth: {
    oauthAccountMergeStrategy: 'link_method',
    oauthProviders: {},
    authMethods: {},
    connectedAccounts: {},
  },
  email: {
    emailServer: {
      isShared: true,
    },
  },
};

/**
 * All fields that can be overridden at this level.
 */
export const projectConfigSchema = yupObject({
  // This is just an example of a field that can only be configured at the project level. Will be actually implemented in the future.
  project: yupObject({
    sourceOfTruthDbConnectionString: yupString().optional(),
  }).defined(),
});

const _permissionDefinitions = yupRecord(
  yupString().defined().matches(permissionRegex),
  yupObject({
    id: yupString().defined(),
    description: yupString().optional(),
    // keys to the contained permissions are the ids of the permissions.
    containedPermissions: yupRecord(
      yupString().defined().matches(permissionRegex),
      yupObject({
        id: yupString().defined(),
      }),
    ).defined(),
  }).defined(),
).defined();

const _permissionDefault = yupRecord(
  yupString().defined().matches(permissionRegex),
  yupObject({
    id: yupString().defined(),
  }),
).defined();

const branchAuth = yupObject({
  oauthAccountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined(),

  // keys to the oauth providers are the provider ids.
  oauthProviders: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(allProviders).defined(),
    }),
  ).defined(),

  // keys to the auth methods are the auth method ids.
  authMethods: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupUnion(
      yupObject({
        id: yupString().defined(),
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['password']).defined(),
      }),
      yupObject({
        id: yupString().defined(),
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['otp']).defined(),
      }),
      yupObject({
        id: yupString().defined(),
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['passkey']).defined(),
      }),
      yupObject({
        id: yupString().defined(),
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['oauth']).defined(),
        oauthProviderId: yupString().defined(),
      }),
    ),
  ).defined(),

  // keys to the connected accounts are the oauth provider ids.
  connectedAccounts: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
      // @deprecated should remove after the config json db migration
      enabled: yupBoolean().defined(),
      oauthProviderId: yupString().defined(),
    }),
  ).defined(),
}).defined();

const branchDomain = yupObject({
  allowLocalhost: yupBoolean().defined(),
}).defined();

export const branchConfigSchema = projectConfigSchema.omit(["project"]).concat(yupObject({
  team: yupObject({
    createTeamOnSignUp: yupBoolean().defined(),
    clientTeamCreationEnabled: yupBoolean().defined(),

    defaultCreatorTeamPermissions: _permissionDefault,
    defaultMemberTeamPermissions: _permissionDefault,
    teamPermissionDefinitions: _permissionDefinitions,
  }).defined(),

  user: yupObject({
    clientUserDeletionEnabled: yupBoolean().defined(),
    signUpEnabled: yupBoolean().defined(),

    defaultProjectPermissions: _permissionDefault,
    userPermissionDefinitions: _permissionDefinitions,
  }).defined(),

  domain: branchDomain,

  auth: branchAuth,
}));


export const environmentConfigSchema = branchConfigSchema.omit(["auth", "domain"]).concat(yupObject({
  auth: branchAuth.omit(["oauthProviders"]).concat(yupObject({
    oauthProviders: yupRecord(
      yupString().defined().matches(permissionRegex),
      yupObject({
        id: yupString().defined(),
        type: yupString().oneOf(allProviders).defined(),
        isShared: yupBoolean().defined(),
        clientId: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true }),
        clientSecret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true }),
        facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
        microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
      }),
    ).defined(),
  }).defined()),

  email: yupObject({
    emailServer: yupUnion(
      yupObject({
        isShared: yupBoolean().isTrue().defined(),
      }),
      yupObject({
        isShared: yupBoolean().isFalse().defined(),
        host: schemaFields.emailHostSchema.defined().nonEmpty(),
        port: schemaFields.emailPortSchema.defined(),
        username: schemaFields.emailUsernameSchema.defined().nonEmpty(),
        password: schemaFields.emailPasswordSchema.defined().nonEmpty(),
        senderName: schemaFields.emailSenderNameSchema.defined().nonEmpty(),
        senderEmail: schemaFields.emailSenderEmailSchema.defined().nonEmpty(),
      })
    ).defined(),
  }).defined(),

  domain: branchDomain.concat(yupObject({
    // keys to the domains are url base64 encoded
    trustedDomains: yupRecord(
      yupString().defined().matches(permissionRegex),
      yupObject({
        baseUrl: schemaFields.urlSchema.defined(),
        handlerPath: schemaFields.handlerPathSchema.defined(),
      }),
    ).defined(),
  })),
}));

export const organizationConfigSchema = environmentConfigSchema.concat(yupObject({}));


export type ProjectIncompleteConfig = yup.InferType<typeof projectConfigSchema>;
export type BranchIncompleteConfig = ProjectIncompleteConfig & yup.InferType<typeof branchConfigSchema>;
export type EnvironmentIncompleteConfig = BranchIncompleteConfig & yup.InferType<typeof environmentConfigSchema>;
export type OrganizationIncompleteConfig = EnvironmentIncompleteConfig & yup.InferType<typeof organizationConfigSchema>;

export const IncompleteConfigSymbol = Symbol('stack-auth-incomplete-config');

export type ProjectRenderedConfig = Omit<ProjectIncompleteConfig,
  | keyof yup.InferType<typeof branchConfigSchema>
  | keyof yup.InferType<typeof environmentConfigSchema>
  | keyof yup.InferType<typeof organizationConfigSchema>
>;
export type BranchRenderedConfig = Omit<BranchIncompleteConfig,
  | keyof yup.InferType<typeof environmentConfigSchema>
  | keyof yup.InferType<typeof organizationConfigSchema>
>;
export type EnvironmentRenderedConfig = Omit<EnvironmentIncompleteConfig,
  | keyof yup.InferType<typeof organizationConfigSchema>
>;
export type OrganizationRenderedConfig = OrganizationIncompleteConfig;

export type ProjectConfigOverride = NormalizesTo<ProjectIncompleteConfig>;
export type BranchConfigOverride = NormalizesTo<BranchIncompleteConfig>;
export type EnvironmentConfigOverride = NormalizesTo<EnvironmentIncompleteConfig>;
export type OrganizationConfigOverride = NormalizesTo<OrganizationIncompleteConfig>;
