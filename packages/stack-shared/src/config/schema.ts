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
  createTeamOnSignUp: false,
  clientTeamCreationEnabled: false,
  clientUserDeletionEnabled: false,
  signUpEnabled: true,
  isProductionMode: false,
  allowLocalhost: true,
  oauthAccountMergeStrategy: 'link_method',
  teamCreateDefaultSystemPermissions: {},
  teamMemberDefaultSystemPermissions: {},
  userDefaultSystemPermissions: {},
  permissionDefinitions: {},
  oauthProviders: {},
  authMethods: {},
  connectedAccounts: {},
  domains: {},
  emailConfig: {
    isShared: true,
  },
};

/**
 * All fields that can be overridden at this level.
 */
export const projectConfigSchema = yupObject({
  // This is just an example of a field that can only be configured at the project level. Will be actually implemented in the future.
  sourceOfTruthDbConnectionString: yupString().optional(),
});


export const branchConfigSchema = projectConfigSchema.omit(["sourceOfTruthDbConnectionString"]).concat(yupObject({
  createTeamOnSignUp: yupBoolean().defined(),
  clientTeamCreationEnabled: yupBoolean().defined(),
  clientUserDeletionEnabled: yupBoolean().defined(),
  signUpEnabled: yupBoolean().defined(),
  isProductionMode: yupBoolean().defined(),
  allowLocalhost: yupBoolean().defined(),
  oauthAccountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined(),

  // keys to the permissions/permission definitions are hex encoded ids.
  teamCreateDefaultPermissions: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
    }),
  ).defined(),

  teamMemberDefaultPermissions: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
    }),
  ).defined(),

  teamPermissionDefinitions: yupRecord(
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
  ).defined(),

  userDefaultPermissions: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
    }),
  ).defined(),

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
}));


export const environmentConfigSchema = branchConfigSchema.concat(yupObject({
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

  emailConfig: yupUnion(
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

  // keys to the domains are url base64 encoded
  domains: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      domain: schemaFields.urlSchema.defined(),
      handlerPath: schemaFields.handlerPathSchema.defined(),
    }),
  ).defined(),
}));


export const organizationConfigSchema = environmentConfigSchema.concat(yupObject({}));


export type ProjectIncompleteConfig = yup.InferType<typeof projectConfigSchema>;
export type BranchIncompleteConfig = ProjectIncompleteConfig & yup.InferType<typeof branchConfigSchema>;
export type EnvironmentIncompleteConfig = BranchIncompleteConfig & yup.InferType<typeof environmentConfigSchema>;
export type OrganizationIncompleteConfig = EnvironmentIncompleteConfig & yup.InferType<typeof organizationConfigSchema>;

export const IncompleteConfigSymbol = Symbol('stack-auth-incomplete-config');

export type ProjectRenderedConfig = yup.InferType<typeof projectConfigSchema>;
export type BranchRenderedConfig = yup.InferType<typeof branchConfigSchema>;
export type EnvironmentRenderedConfig = yup.InferType<typeof environmentConfigSchema>;
export type OrganizationRenderedConfig = yup.InferType<typeof organizationConfigSchema>;

export type ProjectConfigOverride = NormalizesTo<ProjectIncompleteConfig>;
export type BranchConfigOverride = NormalizesTo<BranchIncompleteConfig>;
export type EnvironmentConfigOverride = NormalizesTo<EnvironmentIncompleteConfig>;
export type OrganizationConfigOverride = NormalizesTo<OrganizationIncompleteConfig>;
