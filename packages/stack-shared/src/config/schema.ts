import * as yup from "yup";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { allProviders } from "../utils/oauth";
import { DeepMerge, DeepPartial, get, has, isObjectLike, mapValues, set } from "../utils/objects";
import { Config, NormalizesTo } from "./format";
import { DEFAULT_EMAIL_THEME_ID, DEFAULT_EMAIL_THEMES, DEFAULT_EMAIL_TEMPLATES } from "../helpers/emails";

// NOTE: The validation schemas in here are all schematic validators, not sanity-check validators.
// For more info, see ./README.md


export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;
const customPermissionRegex = /^[a-z0-9_:]+$/;

/**
 * All fields that can be overridden at this level.
 */
export const projectConfigSchema = yupObject({
  sourceOfTruth: yupUnion(
    yupObject({
      type: yupString().oneOf(['hosted']).optional(),
    }).defined(),
    yupObject({
      type: yupString().oneOf(['neon']).optional(),
      connectionStrings: yupRecord(
        yupString().defined(),
        yupString().defined(),
      ).defined(),
    }).defined(),
    yupObject({
      type: yupString().oneOf(['postgres']).optional(),
      connectionString: yupString().defined()
    }).defined(),
  ).optional(),
});

// --- NEW RBAC Schema ---
const branchRbacDefaultPermissions = yupRecord(
  yupString().optional().matches(permissionRegex),
  yupBoolean().isTrue().optional(),
).optional();

const branchRbacSchema = yupObject({
  permissions: yupRecord(
    yupString().optional().matches(customPermissionRegex),
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
  password: yupObject({
    allowSignIn: yupBoolean().optional(),
  }).optional(),
  otp: yupObject({
    allowSignIn: yupBoolean().optional(),
  }).optional(),
  passkey: yupObject({
    allowSignIn: yupBoolean().optional(),
  }).optional(),
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

export const branchConfigSchema = projectConfigSchema.omit(['sourceOfTruth']).concat(yupObject({
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

  emails: yupObject({
    theme: schemaFields.emailThemeSchema.optional(),
    themeList: schemaFields.emailThemeListSchema.optional(),
    templateList: schemaFields.emailTemplateListSchema.optional(),
  }),

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
// NOTE: These values are the defaults of the schema, NOT the defaults for newly created projects. The values here signify what `null` means for each property. If you want new projects by default to have a certain value set to true, you should update the corresponding function in the backend instead.
export const projectConfigDefaults = {
  sourceOfTruth: {
    type: 'hosted',
  },
} satisfies DeepReplaceAllowFunctionsForObjects<ProjectConfigStrippedNormalizedOverride>;

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
    password: {
      allowSignIn: false,
    },
    otp: {
      allowSignIn: false,
    },
    passkey: {
      allowSignIn: false,
    },
    oauth: {
      accountMergeStrategy: 'link_method',
      providers: (key: string) => ({
        isShared: true,
        allowSignIn: false,
        allowConnectedAccounts: false,
      }),
    },
  },

  emails: {
    server: {
      isShared: true,
    },
    theme: DEFAULT_EMAIL_THEME_ID,
    themeList: DEFAULT_EMAIL_THEMES,
    templateList: DEFAULT_EMAIL_TEMPLATES,
  },
} satisfies DeepReplaceAllowFunctionsForObjects<OrganizationConfigStrippedNormalizedOverride>;

export type DeepReplaceAllowFunctionsForObjects<T> = T extends object ? { [K in keyof T]: DeepReplaceAllowFunctionsForObjects<T[K]> } | ((arg: keyof T) => DeepReplaceAllowFunctionsForObjects<T[keyof T]>) : T;
export type DeepReplaceFunctionsWithObjects<T> = T extends (arg: infer K extends string) => infer R ? DeepReplaceFunctionsWithObjects<Record<K, R>> : (T extends object ? { [K in keyof T]: DeepReplaceFunctionsWithObjects<T[K]> } : T);
export type ApplyDefaults<D extends object | ((key: string) => unknown), C extends object> = DeepMerge<DeepReplaceFunctionsWithObjects<D>, C>;
export function applyDefaults<D extends object | ((key: string) => unknown), C extends object>(defaults: D, config: C): ApplyDefaults<D, C> {
  const res: any = typeof defaults === 'function' ? {} : mapValues(defaults, v => typeof v === 'function' ? {} : (typeof v === 'object' ? applyDefaults(v as any, {}) : v));
  for (const [key, mergeValue] of Object.entries(config)) {
    const baseValue = typeof defaults === 'function' ? defaults(key) : (has(defaults, key as any) ? get(defaults, key as any) : undefined);
    if (baseValue !== undefined) {
      if (isObjectLike(baseValue) && isObjectLike(mergeValue)) {
        set(res, key, applyDefaults(baseValue, mergeValue));
        continue;
      }
    }
    set(res, key, mergeValue);
  }
  return res as any;
}
import.meta.vitest?.test("applyDefaults", ({ expect }) => {
  expect(applyDefaults({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  expect(applyDefaults({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  expect(applyDefaults((key: string) => ({ b: key }), { a: {} })).toEqual({ a: { b: "a" } });
  expect(applyDefaults({ a: (key: string) => ({ b: key }) }, { a: { c: { d: 1 } } })).toEqual({ a: { c: { b: "c", d: 1 } } });
  expect(applyDefaults({ a: (key: string) => ({ b: key }) }, {})).toEqual({ a: {} });
  expect(applyDefaults({ a: { b: (key: string) => ({ b: key }) } }, {})).toEqual({ a: { b: {} } });
});

// Normalized overrides
export type ProjectConfigNormalizedOverride = yup.InferType<typeof projectConfigSchema>;
export type BranchConfigNormalizedOverride = yup.InferType<typeof branchConfigSchema>;
export type EnvironmentConfigNormalizedOverride = yup.InferType<typeof environmentConfigSchema>;
export type OrganizationConfigNormalizedOverride = yup.InferType<typeof organizationConfigSchema>;

// Normalized overrides, but only the fields that will NOT be overridden by a future level anymore
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

// Override overrides (used to update the overrides)
export type ProjectConfigOverrideOverride = Config & DeepPartial<ProjectConfigOverride>;
export type BranchConfigOverrideOverride = Config & DeepPartial<BranchConfigOverride>;
export type EnvironmentConfigOverrideOverride = Config & DeepPartial<EnvironmentConfigOverride>;
export type OrganizationConfigOverrideOverride = Config & DeepPartial<OrganizationConfigOverride>;

// Incomplete configs
export type ProjectIncompleteConfig = ApplyDefaults<typeof projectConfigDefaults, ProjectConfigNormalizedOverride>;
export type BranchIncompleteConfig = ApplyDefaults<typeof branchConfigDefaults, ProjectIncompleteConfig & BranchConfigNormalizedOverride>;
export type EnvironmentIncompleteConfig = ApplyDefaults<typeof environmentConfigDefaults, BranchIncompleteConfig & EnvironmentConfigNormalizedOverride>;
export type OrganizationIncompleteConfig = ApplyDefaults<typeof organizationConfigDefaults, EnvironmentIncompleteConfig & OrganizationConfigNormalizedOverride>;

// Rendered configs
export type ProjectRenderedConfig = Omit<ProjectIncompleteConfig,
  | keyof BranchConfigNormalizedOverride
  | keyof EnvironmentConfigNormalizedOverride
  | keyof OrganizationConfigNormalizedOverride
>;
export type BranchRenderedConfig = Omit<BranchIncompleteConfig,
  | keyof EnvironmentConfigNormalizedOverride
  | keyof OrganizationConfigNormalizedOverride
>;
export type EnvironmentRenderedConfig = Omit<EnvironmentIncompleteConfig,
  | keyof OrganizationConfigNormalizedOverride
>;
export type OrganizationRenderedConfig = OrganizationIncompleteConfig;
