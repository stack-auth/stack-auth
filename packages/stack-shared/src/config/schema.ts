import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { NormalizesTo } from "./format";

export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;

export const baseConfig = {
  teams: {
    createTeamOnSignUp: false,
    clientTeamCreationEnabled: false,
    defaultCreatorTeamPermissions: {},
    defaultMemberTeamPermissions: {},
    teamPermissionDefinitions: {},
    allowTeamApiKeys: false,
  },
  users: {
    clientUserDeletionEnabled: false,
    signUpEnabled: true,
    defaultProjectPermissions: {},
    userPermissionDefinitions: {},
    allowUserApiKeys: false,
  },
  domains: {
    allowLocalhost: true,
    trustedDomains: {},
  },
  auth: {
    oauthAccountMergeStrategy: 'link_method',
    oauthProviders: {},
    authMethods: {},
    connectedAccounts: {},
  },
  emails: {
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
  sourceOfTruthDbConnectionString: yupString().optional(),
});

// key: id of the permission definition.
const _permissionDefinitions = yupRecord(
  yupString().defined().matches(permissionRegex),
  yupObject({
    description: yupString().optional(),
    // key: id of the contained permission.
    containedPermissions: yupRecord(
      yupString().defined().matches(permissionRegex),
      yupObject({}),
    ).defined(),
  }).defined(),
).defined();

const _permissionDefault = yupRecord(
  yupString().defined().matches(permissionRegex),
  yupObject({}),
).defined();

const branchAuth = yupObject({
  oauthAccountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined(),

  // key: id of the oauth provider.
  oauthProviders: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      type: yupString().oneOf(allProviders).defined(),
    }),
  ).defined(),

  // key: id of the auth method.
  authMethods: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupUnion(
      yupObject({
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['password']).defined(),
      }),
      yupObject({
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['otp']).defined(),
      }),
      yupObject({
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['passkey']).defined(),
      }),
      yupObject({
        // @deprecated should remove after the config json db migration
        enabled: yupBoolean().defined(),
        type: yupString().oneOf(['oauth']).defined(),
        oauthProviderId: yupString().defined(),
      }),
    ),
  ).defined(),

  // key: id of the connected account.
  connectedAccounts: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      // @deprecated should remove after the config json db migration
      enabled: yupBoolean().defined(),
      oauthProviderId: yupString().defined(),
    }),
  ).defined(),
}).defined();

const branchDomain = yupObject({
  allowLocalhost: yupBoolean().defined(),
}).defined();

export const branchConfigSchema = projectConfigSchema.omit(["sourceOfTruthDbConnectionString"]).concat(yupObject({
  teams: yupObject({
    createTeamOnSignUp: yupBoolean().defined(),
    clientTeamCreationEnabled: yupBoolean().defined(),

    defaultCreatorTeamPermissions: _permissionDefault,
    defaultMemberTeamPermissions: _permissionDefault,
    teamPermissionDefinitions: _permissionDefinitions,

    allowTeamApiKeys: yupBoolean().defined(),
  }).defined(),

  users: yupObject({
    clientUserDeletionEnabled: yupBoolean().defined(),
    signUpEnabled: yupBoolean().defined(),

    defaultProjectPermissions: _permissionDefault,
    userPermissionDefinitions: _permissionDefinitions,

    allowUserApiKeys: yupBoolean().defined(),
  }).defined(),

  domains: branchDomain,

  auth: branchAuth,
}));


export const environmentConfigSchema = branchConfigSchema.omit(["auth", "domains"]).concat(yupObject({
  auth: branchAuth.omit(["oauthProviders"]).concat(yupObject({
    // key: id of the oauth provider.
    oauthProviders: yupRecord(
      yupString().defined().matches(permissionRegex),
      yupObject({
        type: yupString().oneOf(allProviders).defined(),
        isShared: yupBoolean().defined(),
        clientId: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true }),
        clientSecret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true }),
        facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
        microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
      }),
    ).defined(),
  }).defined()),

  emails: yupObject({
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

  domains: branchDomain.concat(yupObject({
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
export type BranchIncompleteConfig = yup.InferType<typeof branchConfigSchema>;
export type EnvironmentIncompleteConfig = yup.InferType<typeof environmentConfigSchema>;
export type OrganizationIncompleteConfig = yup.InferType<typeof organizationConfigSchema>;

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

export type ProjectConfigOverride = NormalizesTo<yup.InferType<typeof projectConfigSchema>>;
export type BranchConfigOverride = NormalizesTo<yup.InferType<typeof branchConfigSchema>>;
export type EnvironmentConfigOverride = NormalizesTo<yup.InferType<typeof environmentConfigSchema>>;
export type OrganizationConfigOverride = NormalizesTo<yup.InferType<typeof organizationConfigSchema>>;
