import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { DeepMerge } from "../utils/objects";
import { PrettifyType } from "../utils/types";
import { NormalizesTo } from "./format";

export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;

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
          clientId: schemaFields.oauthClientIdSchema.optional(),
          clientSecret: schemaFields.oauthClientSecretSchema.optional(),
          facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
          microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
        }),
      ).optional(),
    }).optional()),
  })),

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


// Defaults
export const projectConfigDefaults = {} satisfies ProjectConfigStrippedNormalizedOverride;

export const branchConfigDefaults = {} satisfies BranchConfigStrippedNormalizedOverride;

export const environmentConfigDefaults = {} satisfies EnvironmentConfigStrippedNormalizedOverride;

export const organizationConfigDefaults = {
  rbac: {
    permissions: {},
    defaultPermissions: {
      teamCreator: {},
      teamMember: {},
      signUp: {},
    },
  },

  apiKeys: {
    enabled: {
      team: false,
      user: false,
    },
  },

  teams: {
    createPersonalTeamOnSignUp: false,
    allowClientTeamCreation: false,
  },

  users: {
    allowClientUserDeletion: false,
  },

  domains: {
    allowLocalhost: false,
    trustedDomains: {},
  },

  auth: {
    allowSignUp: true,
    allowPasswordSignIn: false,
    allowOtpSignIn: false,
    allowPasskeySignIn: false,
    oauth: {
      accountMergeStrategy: 'link_method',
      providers: {},
    },
  },

  emails: {
    server: {
      isShared: true,
    },
  },
} satisfies OrganizationConfigStrippedNormalizedOverride;

// Normalized overrides
export type ProjectConfigNormalizedOverride = yup.InferType<typeof projectConfigSchema>;
export type BranchConfigNormalizedOverride = yup.InferType<typeof branchConfigSchema>;
export type EnvironmentConfigNormalizedOverride = yup.InferType<typeof environmentConfigSchema>;
export type OrganizationConfigNormalizedOverride = yup.InferType<typeof organizationConfigSchema>;

// Normalized overrides, without the properties that may be overridden still
export type ProjectConfigStrippedNormalizedOverride = Omit<ProjectConfigNormalizedOverride,
  | keyof BranchConfigNormalizedOverride
  | keyof EnvironmentConfigNormalizedOverride
  | keyof OrganizationConfigNormalizedOverride
>;
export type BranchConfigStrippedNormalizedOverride = Omit<BranchConfigNormalizedOverride,
  | keyof EnvironmentConfigNormalizedOverride
  | keyof OrganizationConfigNormalizedOverride
>;
export type EnvironmentConfigStrippedNormalizedOverride = Omit<EnvironmentConfigNormalizedOverride,
  | keyof OrganizationConfigNormalizedOverride
>;
export type OrganizationConfigStrippedNormalizedOverride = OrganizationConfigNormalizedOverride;

// Overrides
export type ProjectConfigOverride = NormalizesTo<ProjectConfigNormalizedOverride>;
export type BranchConfigOverride = NormalizesTo<BranchConfigNormalizedOverride>;
export type EnvironmentConfigOverride = NormalizesTo<EnvironmentConfigNormalizedOverride>;
export type OrganizationConfigOverride = NormalizesTo<OrganizationConfigNormalizedOverride>;

// Incomplete configs
export type ProjectIncompleteConfig = ProjectConfigNormalizedOverride;
export type BranchIncompleteConfig = ProjectIncompleteConfig & BranchConfigNormalizedOverride;
export type EnvironmentIncompleteConfig = BranchIncompleteConfig & EnvironmentConfigNormalizedOverride;
export type OrganizationIncompleteConfig = EnvironmentIncompleteConfig & OrganizationConfigNormalizedOverride;

// Rendered configs
export type ProjectRenderedConfig = PrettifyType<DeepMerge<typeof projectConfigDefaults, ProjectConfigStrippedNormalizedOverride>>;
export type BranchRenderedConfig = ProjectRenderedConfig & PrettifyType<DeepMerge<typeof branchConfigDefaults, BranchConfigStrippedNormalizedOverride>>;
export type EnvironmentRenderedConfig = BranchRenderedConfig & PrettifyType<DeepMerge<typeof environmentConfigDefaults, EnvironmentConfigStrippedNormalizedOverride>>;
export type OrganizationRenderedConfig = EnvironmentRenderedConfig & PrettifyType<DeepMerge<typeof organizationConfigDefaults, OrganizationConfigStrippedNormalizedOverride>>;


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
    allowPasswordSignIn: true,
    allowOtpSignIn: true,
    allowPasskeySignIn: true,
    oauth: {
      accountMergeStrategy: 'link_method',
      providers: {
        'google_workspace': {
          type: 'google',
          isShared: false,
          clientId: 'google-client-id-for-org',
          clientSecret: 'google-client-secret-for-org',
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
        'github_enterprise': {
          type: 'github',
          isShared: false,
          clientId: 'github-client-id-for-org',
          clientSecret: 'github-client-secret-for-org',
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
        'azure_prod': {
          type: 'microsoft',
          isShared: false,
          clientId: 'azure-client-id-for-org',
          clientSecret: 'azure-client-secret-for-org',
          microsoftTenantId: 'specific-org-tenant-id',
          allowSignIn: true,
          allowConnectedAccounts: true,
        },
        'shared_facebook': {
          type: 'facebook',
          isShared: true,
          facebookConfigId: 'optional-shared-fb-config-id',
          allowSignIn: true,
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
