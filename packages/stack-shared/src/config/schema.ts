import * as yup from "yup";
import { DEFAULT_EMAIL_TEMPLATES, DEFAULT_EMAIL_THEMES, DEFAULT_EMAIL_THEME_ID } from "../helpers/emails";
import * as schemaFields from "../schema-fields";
import { userSpecifiedIdSchema, yupBoolean, yupNumber, yupObject, yupRecord, yupString, yupUnion } from "../schema-fields";
import { SUPPORTED_CURRENCIES } from "../utils/currencies";
import { allProviders } from "../utils/oauth";
import { DeepMerge, DeepPartial, DeepRequiredOrUndefined, get, has, isObjectLike, mapValues, set, typedFromEntries } from "../utils/objects";
import { IntersectAll } from "../utils/types";
import { NormalizesTo } from "./format";

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
      type: yupString().oneOf(['hosted']).defined(),
    }).defined(),
    yupObject({
      type: yupString().oneOf(['neon']).defined(),
      connectionStrings: yupRecord(
        yupString().defined(),
        yupString().defined(),
      ).defined(),
    }).defined(),
    yupObject({
      type: yupString().oneOf(['postgres']).defined(),
      connectionString: yupString().defined()
    }).defined(),
  ).defined(),
}).defined();

// --- NEW RBAC Schema ---
const branchRbacDefaultPermissions = yupRecord(
  yupString().matches(permissionRegex).defined(),
  yupBoolean().isTrue().optional(),
).defined();

const branchRbacSchema = yupObject({
  permissions: yupRecord(
    yupString().matches(customPermissionRegex).defined(),
    yupObject({
      description: yupString().optional(),
      scope: yupString().oneOf(['team', 'project']).optional(),
      containedPermissionIds: yupRecord(
        yupString().matches(permissionRegex).defined(),
        yupBoolean().isTrue().optional()
      ).optional(),
    }).optional(),
  ).defined(),
  defaultPermissions: yupObject({
    teamCreator: branchRbacDefaultPermissions,
    teamMember: branchRbacDefaultPermissions,
    signUp: branchRbacDefaultPermissions,
  }).defined(),
}).defined();
// --- END NEW RBAC Schema ---

// --- NEW API Keys Schema ---
const branchApiKeysSchema = yupObject({
  enabled: yupObject({
    team: yupBoolean().defined(),
    user: yupBoolean().defined(),
  }).defined(),
}).defined();
// --- END NEW API Keys Schema ---


const branchAuthSchema = yupObject({
  allowSignUp: yupBoolean().defined(),
  password: yupObject({
    allowSignIn: yupBoolean().defined(),
  }).defined(),
  otp: yupObject({
    allowSignIn: yupBoolean().defined(),
  }).defined(),
  passkey: yupObject({
    allowSignIn: yupBoolean().defined(),
  }).defined(),
  oauth: yupObject({
    accountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).defined(),
    providers: yupRecord(
      yupString().matches(permissionRegex).defined(),
      yupObject({
        type: yupString().oneOf(allProviders).defined(),
        allowSignIn: yupBoolean().defined(),
        allowConnectedAccounts: yupBoolean().defined(),
      }).defined(),
    ).defined(),
  }).defined(),
}).defined();

const branchPaymentsSchema = yupObject({
  autoPay: yupObject({
    interval: schemaFields.dayIntervalSchema.defined(),
  }).optional(),
  exclusivityGroups: yupRecord(
    userSpecifiedIdSchema("exclusivityGroupId").defined(),
    yupRecord(
      userSpecifiedIdSchema("offerId").defined(),
      yupBoolean().isTrue().defined(),
    ).defined(),
  ).defined(),
  offers: yupRecord(
    userSpecifiedIdSchema("offerId").defined(),
    yupObject({
      customerType: schemaFields.customerTypeSchema.defined(),
      freeTrial: schemaFields.dayIntervalSchema.optional(),
      serverOnly: yupBoolean().defined(),
      stackable: yupBoolean().defined(),
      prices: yupRecord(
        userSpecifiedIdSchema("priceId").defined(),
        yupObject({
          ...typedFromEntries(SUPPORTED_CURRENCIES.map(currency => [currency.code, schemaFields.moneyAmountSchema(currency).optional()])),
          interval: schemaFields.dayIntervalSchema.optional(),
          serverOnly: yupBoolean().defined(),
          freeTrial: schemaFields.dayIntervalSchema.optional(),
        }).defined().test("at-least-one-currency", (value, context) => {
          const currencies = Object.keys(value).filter(key => key.toUpperCase() === key);
          if (currencies.length === 0) {
            return context.createError({ message: "At least one currency is required" });
          }
          return true;
        }).defined(),
      ).defined(),
      items: yupRecord(
        userSpecifiedIdSchema("itemId").defined(),
        yupObject({
          quantity: yupNumber().defined(),
          repeat: schemaFields.dayIntervalOrNeverSchema.optional(),
          expires: yupString().oneOf(['never', 'when-purchase-expires', 'when-repeated']).defined(),
        }).defined(),
      ).defined(),
    }).defined(),
  ).defined(),
  items: yupRecord(
    userSpecifiedIdSchema("itemId").defined(),
    yupObject({
      customerType: schemaFields.customerTypeSchema.defined(),
      default: yupObject({
        quantity: yupNumber().defined(),
        repeat: schemaFields.dayIntervalOrNeverSchema.optional(),
        expires: yupString().oneOf(['never', 'when-repeated']).defined(),
      }).defined().default({
        quantity: 0,
      }),
    }).defined(),
  ).defined(),
}).defined();

const branchDomain = yupObject({
  allowLocalhost: yupBoolean().defined(),
}).defined();

export const branchConfigSchema = projectConfigSchema.omit(['sourceOfTruth']).concat(yupObject({
  rbac: branchRbacSchema,

  teams: yupObject({
    createPersonalTeamOnSignUp: yupBoolean().defined(),
    allowClientTeamCreation: yupBoolean().defined(),
  }).defined(),

  users: yupObject({
    allowClientUserDeletion: yupBoolean().defined(),
  }).defined(),

  apiKeys: branchApiKeysSchema,

  domains: branchDomain,

  auth: branchAuthSchema,

  emails: yupObject({
    theme: schemaFields.emailThemeSchema.defined(),
    themeList: schemaFields.emailThemeListSchema.defined(),
    templateList: schemaFields.emailTemplateListSchema.defined(),
  }).defined(),

  payments: branchPaymentsSchema,
}));


export const environmentConfigSchema = branchConfigSchema.concat(yupObject({
  auth: branchConfigSchema.getNested("auth").concat(yupObject({
    oauth: branchConfigSchema.getNested("auth").getNested("oauth").concat(yupObject({
      providers: yupRecord(
        yupString().matches(permissionRegex).defined(),
        yupObject({
          type: yupString().oneOf(allProviders).defined(),
          isShared: yupBoolean().defined(),
          clientId: schemaFields.oauthClientIdSchema.optional(),
          clientSecret: schemaFields.oauthClientSecretSchema.optional(),
          facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
          microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
          allowSignIn: yupBoolean().optional(),
          allowConnectedAccounts: yupBoolean().optional(),
        }),
      ).defined(),
    }).defined()),
  })),

  emails: branchConfigSchema.getNested("emails").concat(yupObject({
    server: yupObject({
      isShared: yupBoolean().defined(),
      host: schemaFields.emailHostSchema.optional().nonEmpty(),
      port: schemaFields.emailPortSchema.optional(),
      username: schemaFields.emailUsernameSchema.optional().nonEmpty(),
      password: schemaFields.emailPasswordSchema.optional().nonEmpty(),
      senderName: schemaFields.emailSenderNameSchema.optional().nonEmpty(),
      senderEmail: schemaFields.emailSenderEmailSchema.optional().nonEmpty(),
    }).defined(),
  }).defined()),

  domains: branchConfigSchema.getNested("domains").concat(yupObject({
    trustedDomains: yupRecord(
      yupString().uuid().defined(),
      yupObject({
        baseUrl: schemaFields.urlSchema.defined(),
        handlerPath: schemaFields.handlerPathSchema.defined(),
      }),
    ).defined(),
  }).defined()),
}));

export const organizationConfigSchema = environmentConfigSchema.concat(yupObject({}));


// Defaults
// these are objects that are merged together to form the rendered config (see ./README.md)
// Wherever an object could be used as a value, a function can instead be used to generate the default values on a per-key basis
// To make sure you don't accidentally forget setting a default value, you must explicitly set fields with no default value to `undefined`.
// NOTE: These values are the defaults of the schema, NOT the defaults for newly created projects. The values here signify what `null` means for each property. If you want new projects by default to have a certain value set to true, you should update the corresponding function in the backend instead.
export const projectConfigDefaults = {
  sourceOfTruth: {
    type: 'hosted',
  },
} satisfies DefaultsType<ProjectConfigNormalizedOverride, []>;

export const branchConfigDefaults = {
  rbac: {
    permissions: (key: string) => ({
      containedPermissionIds: {},
      description: undefined,
      scope: undefined,
    }),
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
        type: undefined,
        isShared: true,
        allowSignIn: false,
        allowConnectedAccounts: false,
      }),
    },
  },

  emails: {
    theme: DEFAULT_EMAIL_THEME_ID,
    themeList: DEFAULT_EMAIL_THEMES,
    templateList: DEFAULT_EMAIL_TEMPLATES,
  },

  payments: {
    autoPay: undefined,
    exclusivityGroups: {},
    offers: (key: string) => ({
      customerType: undefined,
      freeTrial: undefined,
      serverOnly: false,
      stackable: undefined,
      prices: (key: string) => ({
        ...typedFromEntries(SUPPORTED_CURRENCIES.map(currency => [currency.code, undefined])),
        interval: undefined,
        serverOnly: false,
        freeTrial: undefined,
      }),
      items: (key: string) => ({
        quantity: undefined,
        repeat: undefined,
        expires: "when-repeated",
      }),
    }),
    items: {},
  },
} as const satisfies DefaultsType<BranchConfigNormalizedOverride, [typeof projectConfigDefaults]>;

export const environmentConfigDefaults = {
  domains: {
    trustedDomains: (key: string) => ({
      baseUrl: undefined,
      handlerPath: '/handler',
    }),
  },

  emails: {
    server: {
      isShared: true,
      host: undefined,
      port: undefined,
      username: undefined,
      password: undefined,
      senderName: undefined,
      senderEmail: undefined,
    },
  },

  auth: {
    oauth: {
      providers: (key: string) => ({
        type: undefined,
        isShared: true,
        allowSignIn: false,
        allowConnectedAccounts: false,
        clientId: undefined,
        clientSecret: undefined,
        facebookConfigId: undefined,
        microsoftTenantId: undefined,
      }),
    },
  },
} as const satisfies DefaultsType<EnvironmentConfigNormalizedOverride, [typeof branchConfigDefaults, typeof projectConfigDefaults]>;

export const organizationConfigDefaults = {} satisfies DefaultsType<OrganizationConfigNormalizedOverride, [typeof environmentConfigDefaults, typeof branchConfigDefaults, typeof projectConfigDefaults]>;


type DefaultsType<T, U extends any[]> = DeepReplaceAllowFunctionsForObjects<DeepOmitDefaults<DeepRequiredOrUndefined<T>, IntersectAll<{ [K in keyof U]: DeepReplaceFunctionsWithObjects<U[K]> }>>>;
type DeepOmitDefaults<T, U> = T extends object ? (
  (
    & /* keys that are both in T and U, *and* the key's value in U is not a subtype of the key's value in T */ { [K in { [Ki in keyof T & keyof U]: U[Ki] extends T[Ki] ? never : Ki }[keyof T & keyof U]]: DeepOmitDefaults<T[K], U[K] & object> }
    & /* keys that are in T but not in U */ { [K in Exclude<keyof T, keyof U>]: T[K] }
  )
) : T;

export type DeepReplaceAllowFunctionsForObjects<T> = T extends object ? { [K in keyof T]: DeepReplaceAllowFunctionsForObjects<T[K]> } | (string extends keyof T ? (arg: keyof T) => DeepReplaceAllowFunctionsForObjects<T[keyof T]> : never) : T;
export type DeepReplaceFunctionsWithObjects<T> = T extends (arg: infer K extends string) => infer R ? DeepReplaceFunctionsWithObjects<Record<K, R>> : (T extends object ? { [K in keyof T]: DeepReplaceFunctionsWithObjects<T[K]> } : T);
export type ApplyDefaults<D extends object | ((key: string) => unknown), C extends object> = DeepMerge<DeepReplaceFunctionsWithObjects<D>, C>;
export function applyDefaults<D extends object | ((key: string) => unknown), C extends object>(defaults: D, config: C): ApplyDefaults<D, C> {
  const res: any = typeof defaults === 'function' ? {} : mapValues(defaults, v => typeof v === 'function' ? {} : (typeof v === 'object' ? applyDefaults(v as any, {}) : v));
  outer: for (const [key, mergeValue] of Object.entries(config)) {
    if (mergeValue === undefined) continue;
    const keyParts = key.split(".");
    let baseValue: any = defaults;
    for (const part of keyParts) {
      baseValue = typeof baseValue === 'function' ? baseValue(part) : (has(baseValue, part) ? get(baseValue, part) : undefined);
      if (baseValue === undefined || !isObjectLike(baseValue) || !isObjectLike(mergeValue)) {
        set(res, key, mergeValue);
        continue outer;
      }
    }
    set(res, key, applyDefaults(baseValue, mergeValue));
  }
  return res as any;
}
import.meta.vitest?.test("applyDefaults", ({ expect }) => {
  // Basic
  expect(applyDefaults({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  expect(applyDefaults({ a: { b: 1 } }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
  expect(applyDefaults({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  expect(applyDefaults({ a: { b: { c: 1, d: 2 } } }, { a: { b: { d: 3, e: 4 } } })).toEqual({ a: { b: { c: 1, d: 3, e: 4 } } });

  // Functions
  expect(applyDefaults((key: string) => ({ b: key }), { a: {} })).toEqual({ a: { b: "a" } });
  expect(applyDefaults({ a: (key: string) => ({ b: key }) }, { a: { c: { d: 1 } } })).toEqual({ a: { c: { b: "c", d: 1 } } });
  expect(applyDefaults({ a: (key: string) => ({ b: key }) }, {})).toEqual({ a: {} });
  expect(applyDefaults({ a: { b: (key: string) => ({ b: key }) } }, {})).toEqual({ a: { b: {} } });

  // Dot notation
  expect(applyDefaults({ a: { b: 1 } }, { "a.c": 2 })).toEqual({ a: { b: 1 }, "a.c": 2 });
  expect(applyDefaults({ a: { b: { c: 1 } } }, { "a.b": { d: 2 } })).toEqual({ a: { b: { c: 1 } }, "a.b": { c: 1, d: 2 } });
});

// Normalized overrides
// ex.: { a?: { b?: number, c?: string }, d?: number }
export type ProjectConfigNormalizedOverride = DeepPartial<yup.InferType<typeof projectConfigSchema>>;
export type BranchConfigNormalizedOverride = DeepPartial<yup.InferType<typeof branchConfigSchema>>;
export type EnvironmentConfigNormalizedOverride = DeepPartial<yup.InferType<typeof environmentConfigSchema>>;
export type OrganizationConfigNormalizedOverride = DeepPartial<yup.InferType<typeof organizationConfigSchema>>;

// Overrides
// ex.: { a?: null | { b?: null | number, c: string }, d?: null | number, "a.b"?: number, "a.c"?: string }
export type ProjectConfigOverride = NormalizesTo<ProjectConfigNormalizedOverride>;
export type BranchConfigOverride = NormalizesTo<BranchConfigNormalizedOverride>;
export type EnvironmentConfigOverride = NormalizesTo<EnvironmentConfigNormalizedOverride>;
export type OrganizationConfigOverride = NormalizesTo<OrganizationConfigNormalizedOverride>;

// Override overrides (used to update the overrides)
// ex.: { a?: null | { b?: null | number, c?: string }, d?: null | number, "a.b"?: number, "a.c"?: string }
export type ProjectConfigOverrideOverride = ProjectConfigOverride;
export type BranchConfigOverrideOverride = BranchConfigOverride;
export type EnvironmentConfigOverrideOverride = EnvironmentConfigOverride;
export type OrganizationConfigOverrideOverride = OrganizationConfigOverride;

// Incomplete configs
// note that we infer these types from the override types, not from the schema types directly, as there is no guarantee
// that all configs in the DB satisfy the schema (the only guarantee we make is that this once *used* to be true)
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


// Type assertions (just to make sure the types are correct)
const __assertEmptyObjectIsValidProjectOverride: ProjectConfigOverride = {};
const __assertEmptyObjectIsValidBranchOverride: BranchConfigOverride = {};
const __assertEmptyObjectIsValidEnvironmentOverride: EnvironmentConfigOverride = {};
const __assertEmptyObjectIsValidOrganizationOverride: OrganizationConfigOverride = {};
