// TODO: rename this file to spaghetti.ts because that's the kind of code here

import * as yup from "yup";
import { DEFAULT_EMAIL_TEMPLATES, DEFAULT_EMAIL_THEMES, DEFAULT_EMAIL_THEME_ID } from "../helpers/emails";
import * as schemaFields from "../schema-fields";
import { yupBoolean, yupDate, yupMixed, yupNever, yupNumber, yupObject, yupRecord, yupString, yupTuple, yupUnion } from "../schema-fields";
import { isShallowEqual } from "../utils/arrays";
import { StackAssertionError } from "../utils/errors";
import { allProviders } from "../utils/oauth";
import { DeepFilterUndefined, DeepMerge, DeepRequiredOrUndefined, deleteKey, filterUndefined, get, has, isObjectLike, mapValues, set, typedAssign, typedFromEntries } from "../utils/objects";
import { Result } from "../utils/results";
import { CollapseObjectUnion, Expand, IntersectAll, IsUnion, typeAssert, typeAssertExtends, typeAssertIs } from "../utils/types";
import { Config, NormalizationError, NormalizesTo, assertNormalized, getInvalidConfigReason, normalize } from "./format";

export const configLevels = ['project', 'branch', 'environment', 'organization'] as const;
export type ConfigLevel = typeof configLevels[number];
const permissionRegex = /^\$?[a-z0-9_:]+$/;
const customPermissionRegex = /^[a-z0-9_:]+$/;
declare module "yup" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  export interface CustomSchemaMetadata {
    stackConfigCanNoLongerBeOverridden?: true,
  }
}

function canNoLongerBeOverridden<T extends yup.AnyObjectSchema, K extends string[]>(schema: T, keys: K): yup.Schema<Omit<yup.InferType<T>, K[number]>, T['__context'], Omit<T['__default'], K[number]>, T['__flags']> {
  const notOmitted = schema.concat(yupObject(
    Object.fromEntries(keys.map(key => [key, schema.getNested(key).meta({ stackConfigCanNoLongerBeOverridden: true })]))
  ));
  return notOmitted as any;
}

/**
 * All fields that can be overridden at this level.
 */
export const projectConfigSchema = yupObject({
  sourceOfTruth: yupUnion(
    yupObject({
      type: yupString().oneOf(['hosted']).defined(),
    }),
    yupObject({
      type: yupString().oneOf(['neon']).defined(),
      connectionStrings: yupRecord(
        yupString().defined(),
        yupString().defined(),
      ).defined(),
    }),
    yupObject({
      type: yupString().oneOf(['postgres']).defined(),
      connectionString: yupString().defined()
    }),
  ),
});

// --- NEW RBAC Schema ---
const branchRbacDefaultPermissions = yupRecord(
  yupString().matches(permissionRegex),
  yupBoolean().isTrue().optional(),
);

const branchRbacSchema = yupObject({
  permissions: yupRecord(
    yupString().matches(customPermissionRegex),
    yupObject({
      description: yupString().optional(),
      scope: yupString().oneOf(['team', 'project']).optional(),
      containedPermissionIds: yupRecord(
        yupString().matches(permissionRegex),
        yupBoolean().isTrue().optional()
      ).optional(),
    }).optional(),
  ),
  defaultPermissions: yupObject({
    teamCreator: branchRbacDefaultPermissions,
    teamMember: branchRbacDefaultPermissions,
    signUp: branchRbacDefaultPermissions,
  }),
});
// --- END NEW RBAC Schema ---

// --- NEW API Keys Schema ---
const branchApiKeysSchema = yupObject({
  enabled: yupObject({
    team: yupBoolean(),
    user: yupBoolean(),
  }),
});
// --- END NEW API Keys Schema ---


const branchAuthSchema = yupObject({
  allowSignUp: yupBoolean(),
  password: yupObject({
    allowSignIn: yupBoolean(),
  }),
  otp: yupObject({
    allowSignIn: yupBoolean(),
  }),
  passkey: yupObject({
    allowSignIn: yupBoolean(),
  }),
  oauth: yupObject({
    accountMergeStrategy: yupString().oneOf(['link_method', 'raise_error', 'allow_duplicates']).optional(),
    providers: yupRecord(
      yupString().matches(permissionRegex),
      yupObject({
        type: yupString().oneOf(allProviders).optional(),
        allowSignIn: yupBoolean(),
        allowConnectedAccounts: yupBoolean(),
      }),
    ),
  }),
});

const branchDomain = yupObject({
  allowLocalhost: yupBoolean(),
});

export const branchConfigSchema = canNoLongerBeOverridden(projectConfigSchema, ["sourceOfTruth"]).concat(yupObject({
  rbac: branchRbacSchema,

  teams: yupObject({
    createPersonalTeamOnSignUp: yupBoolean(),
    allowClientTeamCreation: yupBoolean(),
  }),

  users: yupObject({
    allowClientUserDeletion: yupBoolean(),
  }),

  apiKeys: branchApiKeysSchema,

  domains: branchDomain,

  auth: branchAuthSchema,

  emails: yupObject({
    selectedThemeId: schemaFields.emailThemeSchema,
    themes: schemaFields.emailThemeListSchema,
    templates: schemaFields.emailTemplateListSchema,
  }),
}));


export const environmentConfigSchema = branchConfigSchema.concat(yupObject({
  auth: branchConfigSchema.getNested("auth").concat(yupObject({
    oauth: branchConfigSchema.getNested("auth").getNested("oauth").concat(yupObject({
      providers: yupRecord(
        yupString().matches(permissionRegex),
        yupObject({
          type: yupString().oneOf(allProviders).optional(),
          isShared: yupBoolean(),
          clientId: schemaFields.oauthClientIdSchema.optional(),
          clientSecret: schemaFields.oauthClientSecretSchema.optional(),
          facebookConfigId: schemaFields.oauthFacebookConfigIdSchema.optional(),
          microsoftTenantId: schemaFields.oauthMicrosoftTenantIdSchema.optional(),
          issuerUrl: schemaFields.oauthIssuerUrlSchema.optional(),
          allowSignIn: yupBoolean().optional(),
          allowConnectedAccounts: yupBoolean().optional(),
        }),
      ),
    })),
  })),

  emails: branchConfigSchema.getNested("emails").concat(yupObject({
    server: yupObject({
      isShared: yupBoolean(),
      host: schemaFields.emailHostSchema.optional().nonEmpty(),
      port: schemaFields.emailPortSchema.optional(),
      username: schemaFields.emailUsernameSchema.optional().nonEmpty(),
      password: schemaFields.emailPasswordSchema.optional().nonEmpty(),
      senderName: schemaFields.emailSenderNameSchema.optional().nonEmpty(),
      senderEmail: schemaFields.emailSenderEmailSchema.optional().nonEmpty(),
    }),
  })),

  domains: branchConfigSchema.getNested("domains").concat(yupObject({
    trustedDomains: yupRecord(
      yupString(),
      yupObject({
        baseUrl: schemaFields.urlSchema,
        handlerPath: schemaFields.handlerPathSchema,
      }),
    ),
  })),
}));

export const organizationConfigSchema = environmentConfigSchema.concat(yupObject({}));


// Migration functions
//
// These are used to migrate old config overrides to the new format on the database.
//
// THEY SHOULD NOT BE USED FOR ANY OTHER PURPOSE. They should not be used for default values. They should not be used
// for sanitization. Instead, use the applicable functions for that.
//
// We run these migrations over the database when we do a big migration. USE THESE SPARINGLY. USE OTHER METHODS WHENEVER
// POSSIBLE.
//
// The result of this function should be reproducible, and should not contain ANY randomness/non-determinism.
export function migrateConfigOverride(type: "project" | "branch" | "environment" | "organization", oldUnmigratedConfigOverride: any): any {
  const isBranchOrHigher = ["branch", "environment", "organization"].includes(type);
  const isEnvironmentOrHigher = ["environment", "organization"].includes(type);

  let res = oldUnmigratedConfigOverride;

  // BEGIN 2025-07-28: emails.theme is now emails.selectedThemeId
  if (isBranchOrHigher) {
    res = renameProperty(res, "emails.theme", "emails.selectedThemeId");
  }
  // END

  // BEGIN 2025-07-28: domains.trustedDomains can no longer be an array
  if (isEnvironmentOrHigher) {
    res = mapProperty(res, "domains.trustedDomains", (value) => {
      if (Array.isArray(value)) {
        return typedFromEntries(value.map((v, i) => [`${i}`, v]));
      }
      return value;
    });
  }
  // END

  // BEGIN 2025-07-28: themeList and templateList have been renamed (this was before the email release, so they're safe to remove)
  if (isBranchOrHigher) {
    res = removeProperty(res, "emails.themeList");
    res = removeProperty(res, "emails.templateList");
  }
  // END

  // BEGIN 2025-07-28: sourceOfTruth was mistakenly written to the environment config in some cases, so let's remove it
  if (type === "environment") {
    res = removeProperty(res, "sourceOfTruth");
  }
  // END

  // return the result
  return res;
};

function removeProperty(obj: any, path: string): any {
  return mapProperty(obj, path, () => undefined);
}

function mapProperty(obj: any, path: string, mapper: (value: any) => any): any {
  const keyParts = path.split(".");

  for (let i = 0; i < keyParts.length; i++) {
    const pathPrefix = keyParts.slice(0, i).join(".");
    const pathSuffix = keyParts.slice(i).join(".");
    if (has(obj, pathPrefix) && isObjectLike(get(obj, pathPrefix))) {
      const newValue = mapProperty(get(obj, pathPrefix), pathSuffix, mapper);
      set(obj, pathPrefix, newValue);
    }
  }
  if (has(obj, path)) {
    const newValue = mapper(get(obj, path));
    if (newValue !== undefined) {
      set(obj, path, newValue);
    } else {
      deleteKey(obj, path);
    }
  }

  return obj;
}
import.meta.vitest?.test("mapProperty - basic property mapping", ({ expect }) => {
  expect(mapProperty({ a: { b: { c: 1 } } }, "a.b.c", (value) => value + 1)).toEqual({ a: { b: { c: 2 } } });
  expect(mapProperty({ a: { b: { c: 1 } } }, "a.b.d", (value) => value + 1)).toEqual({ a: { b: { c: 1 } } });
  expect(mapProperty({ x: 5 }, "x", (value) => value * 2)).toEqual({ x: 10 });
  expect(mapProperty({ a: { b: { c: 1 } } }, "b.c", (value) => value * 10)).toEqual({ a: { b: { c: 1 } } });
  expect(mapProperty({ a: 1 }, "b.c", (value) => value)).toEqual({ a: 1 });
});

function renameProperty(obj: any, oldPath: string, newPath: string): any {
  const oldKeyParts = oldPath.split(".");
  const newKeyParts = newPath.split(".");
  if (!isShallowEqual(oldKeyParts.slice(0, -1), newKeyParts.slice(0, -1))) throw new StackAssertionError(`oldPath and newPath must have the same prefix. Provided: ${oldPath} and ${newPath}`);

  for (let i = 0; i < oldKeyParts.length; i++) {
    const pathPrefix = oldKeyParts.slice(0, i).join(".");
    const oldPathSuffix = oldKeyParts.slice(i).join(".");
    const newPathSuffix = newKeyParts.slice(i).join(".");
    if (has(obj, pathPrefix) && isObjectLike(get(obj, pathPrefix))) {
      set(obj, pathPrefix, renameProperty(get(obj, pathPrefix), oldPathSuffix, newPathSuffix));
    }
  }
  if (has(obj, oldPath)) {
    set(obj, newPath, get(obj, oldPath));
    deleteKey(obj, oldPath);
  }

  return obj;
}
import.meta.vitest?.test("renameProperty", ({ expect }) => {
  // Basic
  expect(renameProperty({ a: 1 }, "a", "b")).toEqual({ b: 1 });
  expect(renameProperty({ b: { c: 1 } }, "b.c", "b.d")).toEqual({ b: { d: 1 } });
  expect(renameProperty({ a: { b: { c: 1 } } }, "a.b.c", "a.b.d")).toEqual({ a: { b: { d: 1 } } });
  expect(renameProperty({ a: { b: { c: 1 } } }, "a.b.c.d", "a.b.c.e")).toEqual({ a: { b: { c: 1 } } });

  // Errors
  expect(() => renameProperty({ a: 1 }, "a", "b.c")).toThrow();
});


// Defaults
// these are objects that are merged together to form the rendered config (see ./README.md)
// Wherever an object could be used as a value, a function can instead be used to generate the default values on a per-key basis
// To make sure you don't accidentally forget setting a default value, you must explicitly set fields with no default value to `undefined`.
// NOTE: These values are the defaults of the schema, NOT the defaults for newly created projects. The values here signify what `null` means for each property. If you want new projects by default to have a certain value set to true, you should update the corresponding function in the backend instead.
const projectConfigDefaults = {
  sourceOfTruth: {
    type: 'hosted',
    connectionStrings: undefined,
    connectionString: undefined,
  },
} as const satisfies DefaultsType<ProjectRenderedConfigBeforeDefaults, []>;

const branchConfigDefaults = {} as const satisfies DefaultsType<BranchRenderedConfigBeforeDefaults, [typeof projectConfigDefaults]>;

const environmentConfigDefaults = {} as const satisfies DefaultsType<EnvironmentRenderedConfigBeforeDefaults, [typeof branchConfigDefaults, typeof projectConfigDefaults]>;

const organizationConfigDefaults = {
  rbac: {
    permissions: (key: string) => ({
      containedPermissionIds: (key: string) => undefined,
      description: undefined,
      scope: undefined,
    }),
    defaultPermissions: {
      teamCreator: (key: string) => undefined,
      teamMember: (key: string) => undefined,
      signUp: (key: string) => undefined,
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
      baseUrl: undefined,
      handlerPath: '/handler',
    }) as const,
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
        clientId: undefined,
        clientSecret: undefined,
        facebookConfigId: undefined,
        microsoftTenantId: undefined,
        issuerUrl: undefined,
      }),
    },
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
    selectedThemeId: DEFAULT_EMAIL_THEME_ID,
    themes: typedAssign((key: string) => ({
      displayName: "Unnamed Theme",
      tsxSource: "Error: Theme config is missing TypeScript source code.",
    }), DEFAULT_EMAIL_THEMES),
    templates: typedAssign((key: string) => ({
      displayName: "Unnamed Template",
      tsxSource: "Error: Template config is missing TypeScript source code.",
      themeId: undefined,
    }), DEFAULT_EMAIL_TEMPLATES),
  },
} as const satisfies DefaultsType<OrganizationRenderedConfigBeforeDefaults, [typeof environmentConfigDefaults, typeof branchConfigDefaults, typeof projectConfigDefaults]>;

type _DeepOmitDefaultsImpl<T, U> = T extends object ? (
  (
    & /* keys that are both in T and U, *and* the key's value in U is not a subtype of the key's value in T */ { [K in { [Ki in keyof T & keyof U]: U[Ki] extends T[Ki] ? never : Ki }[keyof T & keyof U]]: DeepOmitDefaults<T[K], U[K] & object> }
    & /* keys that are in T but not in U */ { [K in Exclude<keyof T, keyof U>]: T[K] }
  )
) : T;
type DeepOmitDefaults<T, U> = _DeepOmitDefaultsImpl<DeepFilterUndefined<T>, U>;
type DefaultsType<T, U extends any[]> = DeepReplaceAllowFunctionsForObjects<DeepOmitDefaults<DeepRequiredOrUndefined<T>, IntersectAll<{ [K in keyof U]: DeepReplaceFunctionsWithObjects<U[K]> }>>>;
typeAssertIs<DefaultsType<{ a: { b: Record<string, 123>, c: 456 } }, [{ a: { c: 456 } }]>, { a: { b: ((key: string) => 123) | Record<string, 123 | undefined> & ((key: string) => 123) } }>()();

type DeepReplaceAllowFunctionsForObjects<T> = T extends object
  ? (
      string extends keyof T
        ? ((arg: Exclude<keyof T, number>) => DeepReplaceAllowFunctionsForObjects<T[keyof T]>) & ({ [K in keyof T]?: DeepReplaceAllowFunctionsForObjects<T[K]> } | {})
        : { [K in keyof T]: DeepReplaceAllowFunctionsForObjects<T[K]> }
    )
  :
    T;
type ReplaceFunctionsWithObjects<T> = T & (T extends (arg: infer K extends string) => infer R ? Record<K, R> & object : unknown);
type DeepReplaceFunctionsWithObjects<T> = T extends object ? { [K in keyof ReplaceFunctionsWithObjects<T>]: DeepReplaceFunctionsWithObjects<ReplaceFunctionsWithObjects<T>[K]> } : T;
typeAssertIs<DeepReplaceFunctionsWithObjects<{ a: { b: 123 } & ((key: string) => number) }>, { a: { b: 123, [key: string]: number } }>()();

function deepReplaceFunctionsWithObjects(obj: any): any {
  return mapValues({ ...obj }, v => (isObjectLike(v) ? deepReplaceFunctionsWithObjects(v as any) : v));
}
import.meta.vitest?.test("deepReplaceFunctionsWithObjects", ({ expect }) => {
  expect(deepReplaceFunctionsWithObjects(() => {})).toEqual({});
  expect(deepReplaceFunctionsWithObjects({ a: 3 })).toEqual({ a: 3 });
  expect(deepReplaceFunctionsWithObjects({ a: () => ({ b: 1 }) })).toEqual({ a: {} });
  expect(deepReplaceFunctionsWithObjects({ a: typedAssign(() => ({}), { b: { c: 1 } }) })).toEqual({ a: { b: { c: 1 } } });
});

type ApplyDefaults<D extends object | ((key: string) => unknown), C extends object> = {} extends D ? C : DeepMerge<DeepReplaceFunctionsWithObjects<D>, C>;  // the {} extends D makes TypeScript not recurse if the defaults are empty, hence allowing us more recursion until "type instantiation too deep" kicks in... it's a total hack, but it works, so hey?
function applyDefaults<D extends object | ((key: string) => unknown), C extends object>(defaults: D, config: C): ApplyDefaults<D, C> {
  const res: any = deepReplaceFunctionsWithObjects(defaults);

  outer: for (const [key, mergeValue] of Object.entries(config)) {
    if (mergeValue === undefined) continue;
    const keyParts = key.split(".");
    let baseValue: any = defaults;
    let currentRes: any = res;
    for (const [index, part] of keyParts.entries()) {
      baseValue = has(baseValue, part) ? get(baseValue, part) : (typeof baseValue === 'function' ? (baseValue as any)(part) : undefined);
      if (baseValue === undefined || !isObjectLike(baseValue)) {
        set(res, key, mergeValue);
        continue outer;
      }
      if (!has(currentRes, part)) set(currentRes, part, deepReplaceFunctionsWithObjects(baseValue) as never);
      currentRes = get(currentRes, part);
    }
    set(res, key, isObjectLike(mergeValue) ? applyDefaults(baseValue, mergeValue) : mergeValue);
  }
  return res as any;
}
import.meta.vitest?.test("applyDefaults", ({ expect }) => {
  // Basic
  expect(applyDefaults({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  expect(applyDefaults({}, { a: 1 })).toEqual({ a: 1 });
  expect(applyDefaults({ a: { b: 1 } }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
  expect(applyDefaults({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  expect(applyDefaults({ a: { b: { c: 1, d: 2 } } }, { a: { b: { d: 3, e: 4 } } })).toEqual({ a: { b: { c: 1, d: 3, e: 4 } } });

  // Functions
  expect(applyDefaults((key: string) => ({ b: key }), { a: {} })).toEqual({ a: { b: "a" } });
  expect(applyDefaults((key1: string) => (key2: string) => ({ a: key1, b: key2 }), { c: { d: {} } })).toEqual({ c: { d: { a: "c", b: "d" } } });
  expect(applyDefaults({ a: (key: string) => ({ b: key }) }, { a: { c: { d: 1 } } })).toEqual({ a: { c: { b: "c", d: 1 } } });
  expect(applyDefaults({ a: (key: string) => ({ b: key }) }, {})).toEqual({ a: {} });
  expect(applyDefaults({ a: { b: (key: string) => ({ b: key }) } }, {})).toEqual({ a: { b: {} } });
  expect(applyDefaults(typedAssign(() => ({ b: 1 }), { a: { b: 1, c: 2 } }), { a: {} })).toEqual({ a: { b: 1, c: 2 } });
  expect(applyDefaults(typedAssign(() => ({ b: 1 }), { a: { b: 1, c: 2 } }), { d: {} })).toEqual({ a: { b: 1, c: 2 }, d: { b: 1 } });

  // Dot notation
  expect(applyDefaults({ a: { b: 1 } }, { "a.c": 2 })).toEqual({ a: { b: 1 }, "a.c": 2 });
  expect(applyDefaults({ a: 1 }, { "a.b": 2 })).toEqual({ a: 1, "a.b": 2 });
  expect(applyDefaults({ a: null }, { "a.b": 2 })).toEqual({ a: null, "a.b": 2 });
  expect(applyDefaults({ a: { b: { c: 1 } } }, { "a.b": { d: 2 } })).toEqual({ a: { b: { c: 1 } }, "a.b": { c: 1, d: 2 } });
  expect(applyDefaults({ a: { b: { c: { d: 1 } } } }, { "a.b.c": {} })).toEqual({ a: { b: { c: { d: 1 } } }, "a.b.c": { d: 1 } });
  expect(applyDefaults({ a: () => ({ c: 1 }) }, { "a.b": { d: 2 } })).toEqual({ a: { b: { c: 1 } }, "a.b": { c: 1, d: 2 } });
  expect(applyDefaults({ a: () => () => ({ d: 1 }) }, { "a.b.c": {} })).toEqual({ a: { b: { c: { d: 1 } } }, "a.b.c": { d: 1 } });
  expect(applyDefaults({ a: { b: () => ({ c: 1, d: 2 }) } }, { "a.b.x-y.c": 3 })).toEqual({ a: { b: { "x-y": { c: 1, d: 2 } } }, "a.b.x-y.c": 3 });
});

export function applyProjectDefaults<T extends ProjectRenderedConfigBeforeDefaults>(config: T) {
  return applyDefaults(projectConfigDefaults, config);
}

export function applyBranchDefaults<T extends BranchRenderedConfigBeforeDefaults>(config: T) {
  return applyDefaults(
    branchConfigDefaults,
    applyDefaults(
      projectConfigDefaults,
      config
    )
  );
}

export function applyEnvironmentDefaults<T extends EnvironmentRenderedConfigBeforeDefaults>(config: T): ApplyDefaults<typeof environmentConfigDefaults, ApplyDefaults<typeof branchConfigDefaults, ApplyDefaults<typeof projectConfigDefaults, T>>> {
  return applyDefaults(
    environmentConfigDefaults,
    applyDefaults(
      branchConfigDefaults,
      applyDefaults(
        projectConfigDefaults,
        config
      ) as any
    ) as any
  ) as any;
}

export function applyOrganizationDefaults(config: OrganizationRenderedConfigBeforeDefaults): ApplyDefaults<typeof organizationConfigDefaults, ApplyDefaults<typeof environmentConfigDefaults, ApplyDefaults<typeof branchConfigDefaults, ApplyDefaults<typeof projectConfigDefaults, OrganizationRenderedConfigBeforeDefaults>>>> {
  return applyDefaults(
    organizationConfigDefaults,
    applyDefaults(
      environmentConfigDefaults,
      applyDefaults(
        branchConfigDefaults,
        applyDefaults(
          projectConfigDefaults,
          config
        ) as any
      ) as any
    ) as any
  ) as any;
}


export async function sanitizeProjectConfig<T extends ProjectRenderedConfigBeforeSanitization>(config: T) {
  assertNormalized(config);
  const oldSourceOfTruth = config.sourceOfTruth;
  const sourceOfTruth =
    oldSourceOfTruth.type === 'neon' && typeof oldSourceOfTruth.connectionStrings === 'object' ? {
      type: 'neon',
      connectionStrings: { ...filterUndefined(oldSourceOfTruth.connectionStrings) as Record<string, string> }
    } as const
      : oldSourceOfTruth.type === 'postgres' && typeof oldSourceOfTruth.connectionString === 'string' ? {
        type: 'postgres',
        connectionString: oldSourceOfTruth.connectionString,
      } as const
        : {
          type: 'hosted',
        } as const;

  return {
    ...config,
    sourceOfTruth,
  };
}

export async function sanitizeBranchConfig<T extends BranchRenderedConfigBeforeSanitization>(config: T) {
  assertNormalized(config);
  const prepared = await sanitizeProjectConfig(config);
  return {
    ...prepared,
  };
}

export async function sanitizeEnvironmentConfig<T extends EnvironmentRenderedConfigBeforeSanitization>(config: T) {
  assertNormalized(config);
  const prepared = await sanitizeBranchConfig(config);
  return {
    ...prepared,
  };
}

export async function sanitizeOrganizationConfig(config: OrganizationRenderedConfigBeforeSanitization) {
  assertNormalized(config);
  const prepared = await sanitizeEnvironmentConfig(config);
  const themes: typeof prepared.emails.themes = {
    ...DEFAULT_EMAIL_THEMES,
    ...prepared.emails.themes,
  };
  const templates: typeof prepared.emails.templates = {
    ...DEFAULT_EMAIL_TEMPLATES,
    ...prepared.emails.templates,
  };
  return {
    ...prepared,
    emails: {
      ...prepared.emails,
      selectedThemeId: has(themes, prepared.emails.selectedThemeId) ? prepared.emails.selectedThemeId : DEFAULT_EMAIL_THEME_ID,
      themes,
      templates,
    },
  };
}

/**
 * Does not require a base config, and hence solely relies on the override itself to validate the config. If it returns
 * no error, you know that the
 *
 * It's crucial that our DB never contains any configs that are not valid according to this function, as this would mean
 * that the config object does not satisfy the ValidatedToHaveNoConfigOverrideErrors type (which is used as an assumption
 * in a whole bunch of places in the code).
 */
export async function getConfigOverrideErrors<T extends yup.AnySchema>(schema: T, configOverride: unknown, options: { allowPropertiesThatCanNoLongerBeOverridden?: boolean } = {}): Promise<Result<null, string>> {
  // currently, we go over the schema and ensure that the general requirements for each property are satisfied
  // importantly, we cannot check any cross-property constraints, as those may change depending on the base config
  // also, since overrides can be empty, we cannot have any required properties (TODO: can we have required properties in nested objects? would that even make sense? think about it)
  if (typeof configOverride !== "object" || configOverride === null) {
    return Result.error("Config override must be a non-null object.");
  }
  if (Object.getPrototypeOf(configOverride) !== Object.getPrototypeOf({})) {
    return Result.error("Config override must be plain old JavaScript object.");
  }
  // Check config format
  const reason = getInvalidConfigReason(configOverride, { configName: 'override' });
  if (reason) return Result.error("Invalid config format: " + reason);

  const getSubSchema = (schema: yup.AnySchema, key: string): yup.AnySchema | undefined => {
    const keyParts = key.split(".");
    if (!schema.hasNested(keyParts[0])) {
      return undefined;
    }
    const nestedSchema = schema.getNested(keyParts[0]);
    if (nestedSchema.meta()?.stackConfigCanNoLongerBeOverridden && !options.allowPropertiesThatCanNoLongerBeOverridden) {
      return undefined;
    }
    if (keyParts.length === 1) {
      return nestedSchema;
    } else {
      return getSubSchema(nestedSchema, keyParts.slice(1).join("."));
    }
  };

  const getRestrictedSchemaBase = (path: string, schema: yup.AnySchema): yup.AnySchema => {
    const schemaInfo = schema.meta()?.stackSchemaInfo;
    switch (schemaInfo?.type) {
      case "string": {
        const stringSchema = schema as yup.StringSchema<any>;
        const description = stringSchema.describe();
        let res = yupString();
        if (description.tests.some(t => t.name === "uuid")) {
          res = res.uuid();
        }
        return res;
      }
      case "number": {
        return yupNumber();
      }
      case "boolean": {
        return yupBoolean();
      }
      case "date": {
        return yupDate();
      }
      case "mixed": {
        return yupMixed();
      }
      case "array": {
        throw new StackAssertionError(`Arrays are not supported in config JSON files (besides tuples). Use a record instead.`, { schemaInfo, schema });

        // This is how the implementation would look like, but we don't support arrays in config JSON files (besides tuples)
        // const arraySchema = schema as yup.ArraySchema<any, any, any, any>;
        // const innerType = arraySchema.innerType;
        // return yupArray(innerType ? getRestrictedSchema(path + ".[]", innerType as any) : undefined);
      }
      case "tuple": {
        return yupTuple(schemaInfo.items.map((s, index) => getRestrictedSchema(path + `[${index}]`, s)) as any);
      }
      case "union": {
        const schemas = schemaInfo.items;
        const nonObjectSchemas = [...schemas.entries()].filter(([index, s]) => s.meta()?.stackSchemaInfo?.type !== "object");
        const objectSchemas = schemas.filter((s): s is yup.ObjectSchema<any> => s.meta()?.stackSchemaInfo?.type === "object");

        // merge all object schemas into a single schema
        const allObjectSchemaKeys = [...new Set(objectSchemas.flatMap(s => Object.keys(s.fields)))];
        const mergedObjectSchema = yupObject(
          Object.fromEntries(
            allObjectSchemaKeys.map(key => [key, yupUnion(
              ...objectSchemas.flatMap((s, index) => s.hasNested(key) ? [s.getNested(key)] : [])
            )])
          )
        );

        return yupUnion(
          ...nonObjectSchemas.map(([index, s]) => getRestrictedSchema(path + `|variant-${index}|`, s)),
          ...objectSchemas.length > 0 ? [getRestrictedSchema(path + (nonObjectSchemas.length > 0 ? `|variant|` : ""), mergedObjectSchema)] : [],
        );
      }
      case "record": {
        return yupRecord(getRestrictedSchema(path + ".key", schemaInfo.keySchema) as any, getRestrictedSchema(path + ".value", schemaInfo.valueSchema));
      }
      case "object": {
        const objectSchema = schema as yup.ObjectSchema<any>;
        return yupObject(
          Object.fromEntries(
            Object.entries(objectSchema.fields)
              .map(([key, value]) => [key, getRestrictedSchema(path + "." + key, value as any)])
          )
        );
      }
      case "never": {
        return yupNever();
      }
      default: {
        throw new StackAssertionError(`Unknown schema info at path ${path}: ${JSON.stringify(schemaInfo)}`, { schemaInfo, schema });
      }
    }
  };
  const getRestrictedSchema = (path: string, schema: yup.AnySchema): yup.AnySchema => {
    let restricted = getRestrictedSchemaBase(path, schema);
    restricted = restricted.nullable();
    const description = schema.describe();
    if (description.oneOf.length > 0) {
      restricted = restricted.oneOf(description.oneOf);
    }
    if (description.notOneOf.length > 0) {
      restricted = restricted.notOneOf(description.notOneOf);
    }
    return restricted;
  };

  for (const [key, value] of Object.entries(configOverride)) {
    if (value === undefined) continue;
    const subSchema = getSubSchema(schema, key);
    if (!subSchema) {
      return Result.error(`The key ${JSON.stringify(key)} is not valid for the schema.`);
    }
    let restrictedSchema = getRestrictedSchema(key, subSchema);
    try {
      await restrictedSchema.validate(value, {
        strict: true,
        ...{
          // Although `path` is not part of the yup types, it is actually recognized and does the correct thing
          path: key
        },
        context: {
          noUnknownPathPrefixes: [''],
        },
      });
    } catch (error) {
      if (error instanceof yup.ValidationError) {
        return Result.error(error.message);
      }
      throw error;
    }
  }
  return Result.ok(null);
}
export async function assertNoConfigOverrideErrors<T extends yup.AnySchema>(schema: T, config: unknown, options: { allowPropertiesThatCanNoLongerBeOverridden?: boolean, extraInfo?: any } = {}): Promise<void> {
  const res = await getConfigOverrideErrors(schema, config, options);
  if (res.status === "error") throw new StackAssertionError(`Config override is invalid — at a place where it should have already been validated! ${res.error}`, { options, config, schema });
}
type _ValidatedToHaveNoConfigOverrideErrorsImpl<T> =
  IsUnion<T & object> extends true ? _ValidatedToHaveNoConfigOverrideErrorsImpl<CollapseObjectUnion<T & object> | Exclude<T, object>>
  : T extends object ? (T extends any[] ? T : { [K in keyof T]+?: _ValidatedToHaveNoConfigOverrideErrorsImpl<T[K]> })
  : T;
export type ValidatedToHaveNoConfigOverrideErrors<T extends yup.AnySchema> = _ValidatedToHaveNoConfigOverrideErrorsImpl<yup.InferType<T>>;
typeAssertIs<_ValidatedToHaveNoConfigOverrideErrorsImpl<{ a: string } | { b: number } | boolean>, { a?: string, b?: number } | boolean>()();
typeAssertExtends<_ValidatedToHaveNoConfigOverrideErrorsImpl<"abc" | 123 | null>, "abc" | 123 | null>()();
typeAssertExtends<_ValidatedToHaveNoConfigOverrideErrorsImpl<{ a: { b: { c: string } | { d: number } } }>, { a?: { b?: { c?: string, d?: number } } }>()();

/**
 * Checks whether there are any warnings in the incomplete config. A warning doesn't stop the config from being valid,
 * but may require action regardless.
 *
 * The DB can contain configs that are not valid according to this function, as long as they are valid according to
 * the getConfigOverrideErrors function. (This is necessary, because a changing base config may make an override invalid
 * that was previously valid.)
 */
export async function getIncompleteConfigWarnings<T extends yup.AnySchema>(schema: T, incompleteConfig: Config): Promise<Result<null, string>> {
  // every rendered config should also be a config override without errors (regardless of whether it has warnings or not)
  await assertNoConfigOverrideErrors(schema, incompleteConfig, { allowPropertiesThatCanNoLongerBeOverridden: true });

  let normalized: Config;
  try {
    normalized = normalize(incompleteConfig, { onDotIntoNull: "empty-object" });
  } catch (error) {
    if (error instanceof NormalizationError) {
      return Result.error(`Config is not normalizable. ` + error.message);
    }
    throw error;
  }

  // test the schema against the normalized config
  try {
    await schema.validate(normalized, {
      strict: true,
      context: {
        noUnknownPathPrefixes: [''],
      },
    });
    return Result.ok(null);
  } catch (error) {
    if (error instanceof yup.ValidationError) {
      return Result.error(error.message);
    }
    throw error;
  }
}
export type ValidatedToHaveNoIncompleteConfigWarnings<T extends yup.AnySchema> = yup.InferType<T>;


// Normalized overrides
// ex.: { a?: { b?: number, c?: string }, d?: number }
type ProjectConfigNormalizedOverride = Expand<ValidatedToHaveNoConfigOverrideErrors<typeof projectConfigSchema>>;
type BranchConfigNormalizedOverride = Expand<ValidatedToHaveNoConfigOverrideErrors<typeof branchConfigSchema>>;
type EnvironmentConfigNormalizedOverride = Expand<ValidatedToHaveNoConfigOverrideErrors<typeof environmentConfigSchema>>;
type OrganizationConfigNormalizedOverride = Expand<ValidatedToHaveNoConfigOverrideErrors<typeof organizationConfigSchema>>;

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
export type ProjectIncompleteConfig = Expand<ProjectConfigNormalizedOverride>;
export type BranchIncompleteConfig = Expand<ProjectIncompleteConfig & BranchConfigNormalizedOverride>;
export type EnvironmentIncompleteConfig = Expand<BranchIncompleteConfig & EnvironmentConfigNormalizedOverride>;
export type OrganizationIncompleteConfig = Expand<EnvironmentIncompleteConfig & OrganizationConfigNormalizedOverride>;

// Rendered configs before defaults, normalization, and sanitization
type ProjectRenderedConfigBeforeDefaults = Omit<ProjectIncompleteConfig,
  | keyof BranchConfigNormalizedOverride
  | keyof EnvironmentConfigNormalizedOverride
  | keyof OrganizationConfigNormalizedOverride
>;
type BranchRenderedConfigBeforeDefaults = Omit<BranchIncompleteConfig,
  | keyof EnvironmentConfigNormalizedOverride
  | keyof OrganizationConfigNormalizedOverride
>;
type EnvironmentRenderedConfigBeforeDefaults = Omit<EnvironmentIncompleteConfig,
  | keyof OrganizationConfigNormalizedOverride
>;
type OrganizationRenderedConfigBeforeDefaults = OrganizationIncompleteConfig;

// Rendered configs before sanitization
type ProjectRenderedConfigBeforeSanitization = Expand<Awaited<ReturnType<typeof applyProjectDefaults<ProjectRenderedConfigBeforeDefaults>>>>;
type BranchRenderedConfigBeforeSanitization = Expand<Awaited<ReturnType<typeof applyBranchDefaults<BranchRenderedConfigBeforeDefaults>>>>;
type EnvironmentRenderedConfigBeforeSanitization = Expand<Awaited<ReturnType<typeof applyEnvironmentDefaults<EnvironmentRenderedConfigBeforeDefaults>>>>;
type OrganizationRenderedConfigBeforeSanitization = Expand<Awaited<ReturnType<typeof applyOrganizationDefaults>>>;

// Rendered configs after defaults, normalization, and sanitization
export type ProjectRenderedConfig = Expand<Awaited<ReturnType<typeof sanitizeProjectConfig<ProjectRenderedConfigBeforeSanitization>>>>;
export type BranchRenderedConfig = Expand<Awaited<ReturnType<typeof sanitizeBranchConfig<BranchRenderedConfigBeforeSanitization>>>>;
export type EnvironmentRenderedConfig = Expand<Awaited<ReturnType<typeof sanitizeEnvironmentConfig<EnvironmentRenderedConfigBeforeSanitization>>>>;
export type OrganizationRenderedConfig = Expand<Awaited<ReturnType<typeof sanitizeOrganizationConfig>>>;


// Type assertions (just to make sure the types are correct)
const __assertEmptyObjectIsValidProjectOverride: ProjectConfigOverride = {};
const __assertEmptyObjectIsValidBranchOverride: BranchConfigOverride = {};
const __assertEmptyObjectIsValidEnvironmentOverride: EnvironmentConfigOverride = {};
const __assertEmptyObjectIsValidOrganizationOverride: OrganizationConfigOverride = {};
typeAssertExtends<ProjectRenderedConfig, { "sourceOfTruth": any }>()();
typeAssertExtends<BranchRenderedConfig, { "sourceOfTruth": any }>()();
typeAssertExtends<EnvironmentRenderedConfig, { "sourceOfTruth": any }>()();
typeAssertExtends<OrganizationRenderedConfig, { "sourceOfTruth": any }>()();
typeAssert<BranchRenderedConfig extends { "domains": any } ? false : true>()();
typeAssert<EnvironmentRenderedConfig extends { "domains": any } ? false : true>()();
typeAssertExtends<OrganizationRenderedConfig, { "domains": any }>()();
