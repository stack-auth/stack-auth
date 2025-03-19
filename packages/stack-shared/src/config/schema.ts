import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { isUuid } from "../utils/uuids";

export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;

export const projectNormalizedConfigSchema = yupObject({
  // This is just an example of a field that can only be configured at the project level. Will be actually implemented in the future.
  sourceOfTruthDbConnectionString: yupString().optional().meta({ endConfigurableLevel: 'project' }),
});

export type ProjectNormalizedConfig = yup.InferType<typeof projectNormalizedConfigSchema>;

export const branchNormalizedConfigSchema = projectNormalizedConfigSchema.concat(yupObject({
  createTeamOnSignUp: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  clientTeamCreationEnabled: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  clientUserDeletionEnabled: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  signUpEnabled: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  isProductionMode: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  allowLocalhost: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
  oauthAccountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the permissions/permission definitions are hex encoded ids.
  teamCreateDefaultSystemPermissions: yupRecord(yupObject({
    id: yupString().defined(),
  }), (key) => permissionRegex.test(key)).defined().meta({ endConfigurableLevel: 'organization' }),
  teamMemberDefaultSystemPermissions: yupRecord(yupObject({
    id: yupString().defined(),
  }), (key) => permissionRegex.test(key)).defined().meta({ endConfigurableLevel: 'organization' }),
  permissionDefinitions: yupRecord(yupObject({
    id: yupString().defined(),
    description: yupString().defined(),
    // keys to the contained permissions are the ids of the permissions.
    containedPermissions: yupRecord(yupObject({
      id: yupString().defined(),
    })).defined(),
  }), (key) => permissionRegex.test(key)).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the oauth providers are the provider ids.
  oauthProviders: yupRecord(yupObject({
    id: yupString().defined(),
    type: yupString().oneOf(allProviders).defined().meta({ endConfigurableLevel: 'organization' }),
  })).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the auth methods are the auth method ids.
  authMethods: yupRecord(yupUnion(
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['password']).defined(),
    }),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['otp']).defined(),
    }),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['passkey']).defined(),
    }),
    yupObject({
      id: yupString().defined(),
      type: yupString().oneOf(['oauth']).defined(),
      oauthProviderId: yupString().defined(),
    }),
  ), (key) => isUuid(key)).defined().meta({ endConfigurableLevel: 'organization' }),

  // keys to the connected accounts are the oauth provider ids.
  connectedAccounts: yupRecord(yupObject({
    id: yupString().defined(),
    oauthProviderId: yupString().defined(),
  }), (key) => isUuid(key)).defined().meta({ endConfigurableLevel: 'organization' }),
}));

export type BranchNormalizedConfig = yup.InferType<typeof branchNormalizedConfigSchema>;

export const environmentNormalizedConfigSchema = branchNormalizedConfigSchema.concat(yupObject({
  oauthProviders: yupRecord(yupObject({
    id: yupString().defined(),
    type: yupString().oneOf(allProviders).defined().meta({ endConfigurableLevel: 'organization' }),
    isShared: yupBoolean().defined().meta({ endConfigurableLevel: 'organization' }),
    clientId: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true }).meta({ endConfigurableLevel: 'organization' }),
    clientSecret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true }).meta({ endConfigurableLevel: 'organization' }),
    facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional().meta({ endConfigurableLevel: 'organization' }),
    microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional().meta({ endConfigurableLevel: 'organization' }),
  })).defined().meta({ endConfigurableLevel: 'organization' }),

  emailConfig: yupObject({
    isShared: yupBoolean().defined(),
    host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, { isShared: false }),
    port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, { isShared: false }),
    username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, { isShared: false }),
    password: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailPasswordSchema, { isShared: false }),
    senderName: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderNameSchema, { isShared: false }),
    senderEmail: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderEmailSchema, { isShared: false }),
  }).meta({ endConfigurableLevel: 'organization' }),

  // keys to the domains are the hex encoded domains
  domains: yupRecord(yupObject({
    domain: schemaFields.urlSchema.defined(),
    handlerPath: schemaFields.handlerPathSchema.defined(),
  }), (key) => key.match(/^[a-zA-Z0-9_]+$/) !== null).meta({ endConfigurableLevel: 'organization' }),
}));

export type EnvironmentNormalizedConfig = yup.InferType<typeof environmentNormalizedConfigSchema>;

export const organizationConfigSchema = environmentNormalizedConfigSchema.concat(yupObject({}));

export type OrganizationConfig = yup.InferType<typeof organizationConfigSchema>;

export const defaultConfig = {
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
} satisfies yup.InferType<typeof organizationConfigSchema>;
