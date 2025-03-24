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
  sourceOfTruthDbConnectionString: yupString().optional().meta({ endConfigurableLevel: 'project' }),
});


export const branchConfigSchema = projectConfigSchema.omit(["sourceOfTruthDbConnectionString"]).concat(yupObject({
  createTeamOnSignUp: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  clientTeamCreationEnabled: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  clientUserDeletionEnabled: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  signUpEnabled: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  isProductionMode: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  allowLocalhost: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  oauthAccountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the permissions/permission definitions are hex encoded ids.
  teamCreateDefaultSystemPermissions: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
    }),
  ).defined().meta({ endConfigurableLevel: 'organization' }),

  teamMemberDefaultSystemPermissions: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
    }),
  ).defined().meta({ endConfigurableLevel: 'organization' }),

  teamPermissionDefinitions: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
      description: yupString().defined(),
      // keys to the contained permissions are the ids of the permissions.
      containedPermissions: yupRecord(
        yupString().defined().matches(permissionRegex),
        yupObject({
          id: yupString().defined(),
        }),
      ).defined(),
    }).defined(),
  ).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the oauth providers are the provider ids.
  oauthProviders: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(allProviders).defined().meta({ endConfigurableLevel: 'organization' }),
    }),
  ).defined().meta({ endConfigurableLevel: 'organization' }),

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
  ).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the connected accounts are the oauth provider ids.
  connectedAccounts: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
      // @deprecated should remove after the config json db migration
      enabled: yupBoolean().defined(),
      oauthProviderId: yupString().defined(),
    }),
  ).defined().meta({ endConfigurableLevel: 'organization' }),
}));


export const environmentConfigSchema = branchConfigSchema.concat(yupObject({
  oauthProviders: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(allProviders).defined().meta({ endConfigurableLevel: 'organization' }),
      isShared: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
      clientId: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true }).meta({ endConfigurableLevel: 'organization' }),
      clientSecret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true }).meta({ endConfigurableLevel: 'organization' }),
      facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional().meta({ endConfigurableLevel: 'organization' }),
      microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional().meta({ endConfigurableLevel: 'organization' }),
    }),
  ).defined().meta({ endConfigurableLevel: 'organization' }),

  emailConfig: yupUnion(
    yupObject({
      isShared: yupBoolean().oneOf([true]).defined(),
    }),
    yupObject({
      isShared: yupBoolean().oneOf([false]).defined(),
      host: schemaFields.emailHostSchema.defined().nonEmpty(),
      port: schemaFields.emailPortSchema.defined(),
      username: schemaFields.emailUsernameSchema.defined().nonEmpty(),
      password: schemaFields.emailPasswordSchema.defined().nonEmpty(),
      senderName: schemaFields.emailSenderNameSchema.defined().nonEmpty(),
      senderEmail: schemaFields.emailSenderEmailSchema.defined().nonEmpty(),
    })
  ).meta({ endConfigurableLevel: 'organization' }),

  // keys to the domains are the hex encoded domains
  domains: yupRecord(
    yupString().defined().matches(permissionRegex),
    yupObject({
      domain: schemaFields.urlSchema.defined(),
      handlerPath: schemaFields.handlerPathSchema.defined(),
    }),
  ).defined().meta({ endConfigurableLevel: 'organization' }),
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
