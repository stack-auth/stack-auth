import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { NormalizesTo } from "./format";

export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;

export const baseConfig = {
  // must be empty
};

/**
 * All fields that can be overridden at this level.
 */
export const projectConfigSchema = yupObject({});

// --- NEW RBAC Schema ---
const branchRbacDefaultPermissions = yupRecord(
  yupString().optional().matches(permissionRegex),
  yupBoolean().isTrue().optional(),
).optional();

const branchRbacSchema = yupObject({
  permissions: yupRecord(
    yupString().optional().matches(permissionRegex),
    yupObject({
      description: yupString().optional(),
      scope: yupString().oneOf(['team', 'project']).optional(),
      containedPermissionIds: yupRecord(
        yupString().optional().matches(permissionRegex),
        yupBoolean().isTrue().optional()
      ).optional(),
    }).optional(),
  ).optional(),
  defaultPermissions: yupObject({
    teamCreator: branchRbacDefaultPermissions,
    teamMember: branchRbacDefaultPermissions,
    signUp: branchRbacDefaultPermissions,
  }).optional(),
}).optional();
// --- END NEW RBAC Schema ---

// --- NEW API Keys Schema ---
const branchApiKeysSchema = yupObject({
  enabled: yupObject({
    team: yupBoolean().optional(),
    user: yupBoolean().optional(),
  }).optional(),
}).optional();
// --- END NEW API Keys Schema ---


const branchAuthSchema = yupObject({
  allowSignUp: yupBoolean().optional(),
  allowPasswordSignIn: yupBoolean().optional(),
  allowOtpSignIn: yupBoolean().optional(),
  allowPasskeySignIn: yupBoolean().optional(),
  oauth: yupObject({
    accountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).optional(),
    providers: yupRecord(
      yupString().optional().matches(permissionRegex),
      yupObject({
        type: yupString().oneOf(allProviders).optional(),
        allowSignIn: yupBoolean().optional(),
        allowConnectedAccounts: yupBoolean().optional(),
      }),
    ).optional(),
  }).optional(),
}).optional();

const branchDomain = yupObject({
  allowLocalhost: yupBoolean().optional(),
}).optional();

export const branchConfigSchema = projectConfigSchema.concat(yupObject({
  rbac: branchRbacSchema,

  teams: yupObject({
    createPersonalTeamOnSignUp: yupBoolean().optional(),
    allowClientTeamCreation: yupBoolean().optional(),
  }).optional(),

  users: yupObject({
    allowClientUserDeletion: yupBoolean().optional(),
  }).optional(),

  apiKeys: branchApiKeysSchema,

  domains: branchDomain,

  auth: branchAuthSchema,

  emails: yupObject({}),
}));


export const environmentConfigSchema = branchConfigSchema.concat(yupObject({
  auth: branchConfigSchema.getNested("auth").concat(yupObject({
    oauth: branchConfigSchema.getNested("auth").getNested("oauth").concat(yupObject({
      providers: yupRecord(
        yupString().optional().matches(permissionRegex),
        yupObject({
          type: yupString().oneOf(allProviders).optional(),
          isShared: yupBoolean().optional(),
          clientId: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientIdSchema, { type: 'standard', enabled: true }),
          clientSecret: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.oauthClientSecretSchema, { type: 'standard', enabled: true }),
          facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
          microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
        }),
      ).optional(),
    }).optional()),
  })).optional(),

  emails: branchConfigSchema.getNested("emails").concat(yupObject({
    server: yupObject({
      isShared: yupBoolean().optional(),
      host: schemaFields.emailHostSchema.optional().nonEmpty(),
      port: schemaFields.emailPortSchema.optional(),
      username: schemaFields.emailUsernameSchema.optional().nonEmpty(),
      password: schemaFields.emailPasswordSchema.optional().nonEmpty(),
      senderName: schemaFields.emailSenderNameSchema.optional().nonEmpty(),
      senderEmail: schemaFields.emailSenderEmailSchema.optional().nonEmpty(),
    }),
  }).optional()),

  domains: branchConfigSchema.getNested("domains").concat(yupObject({
    trustedDomains: yupRecord(
      yupString().uuid().optional(),
      yupObject({
        baseUrl: schemaFields.urlSchema.optional(),
        handlerPath: schemaFields.handlerPathSchema.optional(),
      }),
    ).optional(),
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


const exampleOrgConfig: OrganizationRenderedConfig = {
  rbac: {
    permissions: {
      'admin': {
        scope: 'team',
        containedPermissionIds: {
          'member': true,
        },
      },
      'something': {
        scope: 'project',
        containedPermissionIds: {},
      },
    },
    defaultPermissions: {
      teamCreator: {
        'admin': true,
      },
      teamMember: {
        'member': true,
      },
      signUp: {
        'something': true,
      },
    },
  },

  apiKeys: {
    enabled: {
      team: true,
      user: false,
    },
  },

  teams: {
    createPersonalTeamOnSignUp: true,
    allowClientTeamCreation: true,
  },

  users: {
    allowClientUserDeletion: false,
  },

  domains: {
    allowLocalhost: false,
    trustedDomains: {
      'prod_app_domain': {
        baseUrl: 'https://app.my-saas.com',
        handlerPath: '/api/auth/callback',
      },
      'staging_app_domain': {
        baseUrl: 'https://staging.my-saas.com',
        handlerPath: '/auth/handler',
      },
    },
  },

  auth: {
    allowSignUp: true,
    passwordAuthEnabled: true,
    otpAuthEnabled: true,
    passkeyAuthEnabled: true,
    oauth: {
      accountMergeStrategy: 'link_method',
      providers: {
        'google_workspace': {
          type: 'google',
          isShared: false,
          clientId: 'google-client-id-for-org',
          clientSecret: 'google-client-secret-for-org',
          allowAuth: true,
          allowConnectedAccounts: true,
        },
        'github_enterprise': {
          type: 'github',
          isShared: false,
          clientId: 'github-client-id-for-org',
          clientSecret: 'github-client-secret-for-org',
          allowAuth: true,
          allowConnectedAccounts: true,
        },
        'azure_prod': {
          type: 'microsoft',
          isShared: false,
          clientId: 'azure-client-id-for-org',
          clientSecret: 'azure-client-secret-for-org',
          microsoftTenantId: 'specific-org-tenant-id',
          allowAuth: true,
          allowConnectedAccounts: true,
        },
        'shared_facebook': {
          type: 'facebook',
          isShared: true,
          facebookConfigId: 'optional-shared-fb-config-id',
          allowAuth: true,
          allowConnectedAccounts: true,
        }
      },
    },
  },

  emails: {
    server: {
      isShared: false,
      host: 'smtp.organization.com',
      port: 587,
      username: 'org-smtp-username',
      password: 'org-smtp-password',
      senderName: 'My Org App Name',
      senderEmail: 'noreply@my-saas-org.com',
    },
  },
};
