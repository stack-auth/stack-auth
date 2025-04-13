import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { DeepMerge, get, has, isObjectLike, set } from "../utils/objects";
import { PrettifyType } from "../utils/types";
import { NormalizesTo } from "./format";

// NOTE: The validation schemas in here are all schematic validators, not sanity-check validators.
// For more info, see ./README.md


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
      }).defined(),
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
          allowSignIn: yupBoolean().optional(),
          allowConnectedAccounts: yupBoolean().optional(),
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
// these are objects that are merged together to form the rendered config (see ./README.md)
// Wherever an object could be used as a value, a function can instead be used to generate the default values on a per-key basis
export const projectConfigDefaults = {} satisfies DeepReplaceAllowFunctionsForObjects<ProjectConfigStrippedNormalizedOverride>;

export const branchConfigDefaults = {} satisfies DeepReplaceAllowFunctionsForObjects<BranchConfigStrippedNormalizedOverride>;

export const environmentConfigDefaults = {} satisfies DeepReplaceAllowFunctionsForObjects<EnvironmentConfigStrippedNormalizedOverride>;

export const organizationConfigDefaults = {
  rbac: {
    permissions: (key: string) => ({}),
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
    trustedDomains: (key: string) => ({
      handlerPath: '/handler',
    }),
  },

  auth: {
    allowSignUp: true,
    allowPasswordSignIn: false,
    allowOtpSignIn: false,
    allowPasskeySignIn: false,
    oauth: {
      accountMergeStrategy: 'link_method',
      providers: (key: string) => ({
        allowSignIn: false,
        allowConnectedAccounts: false,
      }),
    },
  },

  emails: {
    server: {
      isShared: true,
    },
  },
} satisfies DeepReplaceAllowFunctionsForObjects<OrganizationConfigStrippedNormalizedOverride>;

export type DeepReplaceAllowFunctionsForObjects<T> = T extends object ? { [K in keyof T]: DeepReplaceAllowFunctionsForObjects<T[K]> } | ((arg: keyof T) => DeepReplaceAllowFunctionsForObjects<T[keyof T]>) : T;
export type DeepReplaceFunctionsWithObjects<T> = T extends (arg: infer K extends string) => infer R ? DeepReplaceFunctionsWithObjects<Record<K, R>> : (T extends object ? { [K in keyof T]: DeepReplaceFunctionsWithObjects<T[K]> } : T);
export type ApplyDefaults<D extends object, C extends object> = DeepMerge<DeepReplaceFunctionsWithObjects<D>, C>;
export function applyDefaults<D extends object, C extends object>(defaults: D, config: C): ApplyDefaults<D, C> {
  const res: any = { ...defaults };
  for (const [key, mergeValue] of Object.entries(config)) {
    if (has(res, key as any)) {
      const baseValue = typeof res === 'function' ? res(key) : get(res, key as any);
      if (isObjectLike(baseValue) && isObjectLike(mergeValue)) {
        set(res, key, applyDefaults(baseValue, mergeValue));
        continue;
      }
    }
    set(res, key, mergeValue);
  }
  return res as any;
}

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
export type ProjectRenderedConfig = PrettifyType<ApplyDefaults<typeof projectConfigDefaults, ProjectConfigStrippedNormalizedOverride>>;
export type BranchRenderedConfig = PrettifyType<ProjectRenderedConfig & ApplyDefaults<typeof branchConfigDefaults, BranchConfigStrippedNormalizedOverride>>;
export type EnvironmentRenderedConfig = PrettifyType<BranchRenderedConfig & ApplyDefaults<typeof environmentConfigDefaults, EnvironmentConfigStrippedNormalizedOverride>>;
export type OrganizationRenderedConfig = PrettifyType<EnvironmentRenderedConfig & ApplyDefaults<typeof organizationConfigDefaults, OrganizationConfigStrippedNormalizedOverride>>;


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
