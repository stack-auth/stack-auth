import { CompleteConfig } from "@hexclave/shared/dist/config/schema";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";

/**
 * OAuth scopes for a Hexclave project acting as an OAuth provider.
 *
 * The central idea: **scopes are a projection of RBAC, and they can only narrow.** A project already
 * declares its authority vocabulary as permissions (`config.rbac.permissions`), complete with
 * human-readable descriptions and a containment hierarchy. Inventing a second, parallel vocabulary
 * for OAuth would mean asking customers to define the same concepts twice and keep them in sync by
 * hand — so instead every permission automatically *is* a scope.
 *
 * The rule that makes this safe:
 *
 * > Effective authority = granted scopes ∩ the user's live permissions.
 *
 * Consent can never escalate. A client that asks for `perm:$delete_team` gets nothing if the user
 * isn't a team admin. Scopes are stamped into the token (they record the delegation the user
 * consented to); permissions are resolved live on every check (they record the authority the user
 * actually has). So revoking a permission takes effect immediately, and a stale scope list in an
 * old token is fail-safe, because a scope list can only ever shrink authority.
 */

/**
 * Scope name prefixes we own. A custom scope may not use these, because a customer scope named
 * `perm:foo` would silently shadow the permission projection and read as authority it doesn't grant.
 */
export const PROJECT_PERMISSION_SCOPE_PREFIX = "perm";
export const TEAM_PERMISSION_SCOPE_PREFIX = "team_perm";

/**
 * Standard OIDC scopes. These don't map to permissions — they control which claims appear in the
 * ID token and UserInfo response, which is the OIDC spec's business, not ours.
 */
export const OIDC_STANDARD_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export const RESERVED_SCOPE_PREFIXES = [PROJECT_PERMISSION_SCOPE_PREFIX, TEAM_PERMISSION_SCOPE_PREFIX] as const;

export type ParsedScope =
  /** Authority to exercise a project-scoped permission. */
  | { type: "project_permission", permissionId: string }
  /** Authority to exercise a team-scoped permission, in any team the user belongs to. */
  | { type: "team_permission", permissionId: string }
  /** A standard OIDC scope — affects claims, not authority. */
  | { type: "oidc", scope: typeof OIDC_STANDARD_SCOPES[number] }
  /** A customer-defined scope with meaning only to their own resource server. */
  | { type: "custom", scopeId: string };

/**
 * Splits a scope on its **first** colon only.
 *
 * This is load-bearing. Permission IDs may themselves contain colons (`customPermissionRegex` is
 * `/^[a-z0-9_:]+$/`), so `perm:billing:read` is the single permission `billing:read`, not a
 * three-part path. Splitting on every colon would silently mangle any customer using colons as a
 * namespace separator in their permission IDs — which is exactly what a colon invites.
 */
function splitOnFirstColon(scope: string): { prefix: string, rest: string } | null {
  const colonIndex = scope.indexOf(":");
  if (colonIndex === -1) return null;
  return { prefix: scope.slice(0, colonIndex), rest: scope.slice(colonIndex + 1) };
}

/**
 * Parses a scope string, or returns `null` if it is malformed.
 *
 * Note that this validates *shape*, not *existence*: `perm:nonexistent` parses fine. Whether a scope
 * actually exists on a given project is `assertScopesGrantable`'s job, because that needs the config.
 */
export function tryParseScope(scope: string): ParsedScope | null {
  if (scope.length === 0) return null;

  if ((OIDC_STANDARD_SCOPES as readonly string[]).includes(scope)) {
    return { type: "oidc", scope: scope as typeof OIDC_STANDARD_SCOPES[number] };
  }

  const split = splitOnFirstColon(scope);
  if (split) {
    switch (split.prefix) {
      case PROJECT_PERMISSION_SCOPE_PREFIX: {
        if (!isValidPermissionId(split.rest)) return null;
        return { type: "project_permission", permissionId: split.rest };
      }
      case TEAM_PERMISSION_SCOPE_PREFIX: {
        if (!isValidPermissionId(split.rest)) return null;
        return { type: "team_permission", permissionId: split.rest };
      }
      // Any other prefix falls through to the custom-scope branch below. A custom scope may contain
      // colons (`files:read` is the conventional OAuth style and we want to allow it) — it just may
      // not start with one of ours.
    }
  }

  if (!isValidCustomScopeId(scope)) return null;
  return { type: "custom", scopeId: scope };
}

export function parseScope(scope: string): ParsedScope {
  return tryParseScope(scope) ?? throwErr("Scope is malformed.", { scope });
}

/**
 * Mirrors `permissionRegex` in `packages/shared/src/config/schema.ts` — permission IDs are lowercase
 * alphanumeric with underscores and colons, optionally `$`-prefixed for the built-in team system
 * permissions (`$delete_team` etc.).
 */
function isValidPermissionId(permissionId: string): boolean {
  return /^\$?[a-z0-9_:]+$/.test(permissionId);
}

function isValidCustomScopeId(scopeId: string): boolean {
  return /^[a-z0-9_:.-]+$/.test(scopeId);
}

export function getProjectPermissionScope(permissionId: string): string {
  return `${PROJECT_PERMISSION_SCOPE_PREFIX}:${permissionId}`;
}

export function getTeamPermissionScope(permissionId: string): string {
  return `${TEAM_PERMISSION_SCOPE_PREFIX}:${permissionId}`;
}

/**
 * A scope as presented to a human on the consent screen.
 */
export type ScopeDefinition = {
  scope: string,
  /** Short label. Falls back to the scope string when the customer wrote no description. */
  displayName: string,
  /**
   * The sentence shown on the consent screen. For permission scopes this is the `description` the
   * customer already wrote in their RBAC config — which is why defining a permission gets you a
   * usable consent screen for free.
   */
  description: string | null,
  source: ParsedScope["type"],
};

/**
 * A permission definition, structurally. Taken as a parameter rather than imported from
 * `permissions.tsx` so this module stays the lower layer — `permissions.tsx` imports
 * `narrowPermissionsByScopes` from here, and a cycle between the two would be fragile at module-init
 * time for something this load-bearing.
 */
export type PermissionDefinitionLike = { id: string, description?: string };

/**
 * The complete scope vocabulary of a project: every permission projected into a scope, plus any
 * custom scopes the customer declared, plus the OIDC standard scopes.
 *
 * This is what `scopes_supported` in the discovery document is built from, and what the consent
 * screen renders. Call it via `deriveScopesForTenancy` in `permissions.tsx`, which supplies the
 * permission definitions.
 */
export function deriveScopes(options: {
  config: CompleteConfig,
  projectPermissions: PermissionDefinitionLike[],
  teamPermissions: PermissionDefinitionLike[],
}): ScopeDefinition[] {
  const { config, projectPermissions, teamPermissions } = options;

  const definitions: ScopeDefinition[] = [
    ...OIDC_STANDARD_SCOPES.map((scope): ScopeDefinition => ({
      scope,
      displayName: scope,
      description: null,
      source: "oidc",
    })),
    ...projectPermissions.map((p): ScopeDefinition => ({
      scope: getProjectPermissionScope(p.id),
      displayName: p.id,
      description: p.description ?? null,
      source: "project_permission",
    })),
    ...teamPermissions.map((p): ScopeDefinition => ({
      scope: getTeamPermissionScope(p.id),
      displayName: p.id,
      description: p.description ?? null,
      source: "team_permission",
    })),
    // Custom scopes are keyed in config by an opaque ID, with the scope string as a value (a scope
    // name contains dots and colons, which a config key can't). An entry with no `scope` yet is
    // half-configured in the dashboard and simply isn't a scope until it's filled in.
    ...Object.values(config.oauthProvider.scopes).flatMap((scope): ScopeDefinition[] => {
      if (scope.scope === undefined) return [];
      return [{
        scope: scope.scope,
        displayName: scope.displayName ?? scope.scope,
        description: scope.description ?? null,
        source: "custom",
      }];
    }),
  ];

  return definitions.sort((a, b) => stringCompare(a.scope, b.scope));
}

/**
 * The result of checking a set of requested scopes against a project's vocabulary.
 */
export type ScopeValidationResult =
  | { valid: true, scopes: ScopeDefinition[] }
  | { valid: false, unknownScopes: string[] };

/**
 * Checks that every requested scope exists on this project.
 *
 * Deliberately fails on unknown scopes rather than silently dropping them: a client that asks for
 * `perm:delete_everything` and gets a token back with that scope quietly removed will behave as
 * though it has authority it doesn't, and the failure will surface much later and much less legibly
 * than an `invalid_scope` at the authorize endpoint.
 */
export function validateScopes(availableScopes: ScopeDefinition[], requestedScopes: string[]): ScopeValidationResult {
  const available = new Map(availableScopes.map(d => [d.scope, d]));
  const unknownScopes: string[] = [];
  const scopes: ScopeDefinition[] = [];

  for (const requested of requestedScopes) {
    const definition = available.get(requested);
    if (!definition) {
      unknownScopes.push(requested);
      continue;
    }
    scopes.push(definition);
  }

  if (unknownScopes.length > 0) return { valid: false, unknownScopes };
  return { valid: true, scopes };
}

/**
 * A permission as returned by `listPermissions`. Structural rather than imported so this module
 * stays usable from both the team and project permission shapes.
 */
export type PermissionLike = { id: string, team_id?: string, user_id: string };

/**
 * Narrows a list of the user's effective permissions to those the token was granted authority over.
 *
 * `grantedScopes === null` means "full authority" — an ordinary session token, which is every token
 * Hexclave issued before OAuth scopes existed. `null` and `[]` are meaningfully different: `[]` is a
 * token that consented to nothing and therefore has no permission-backed authority at all.
 *
 * This is where the intersection rule is actually applied. Note the asymmetry: we filter the *live*
 * permission list, so a scope naming a permission the user doesn't hold contributes nothing. There
 * is no code path here that can add a permission.
 */
export function narrowPermissionsByScopes<P extends PermissionLike>(
  permissions: P[],
  grantedScopes: string[] | null,
  scope: "team" | "project",
): P[] {
  if (grantedScopes === null) return permissions;

  // Team and project permissions live in separate namespaces and must not cross over: a
  // `team_perm:admin` grant says nothing about a project permission that happens to also be called
  // `admin`.
  const wantedType = scope === "team" ? "team_permission" : "project_permission";
  const grantedPermissionIds = new Set<string>();
  for (const grantedScope of grantedScopes) {
    const parsed = tryParseScope(grantedScope);
    // An unparsable scope in an already-issued token grants nothing. It can't be an assertion
    // failure, because a token minted before a scope was renamed is a legitimate state — and the
    // fail-safe direction is to grant less.
    if (!parsed) continue;
    if (parsed.type === wantedType) {
      grantedPermissionIds.add(parsed.permissionId);
    }
  }

  return permissions.filter(p => grantedPermissionIds.has(p.id));
}

/**
 * Asserts that a set of scopes may be written into a project's config as *custom* scopes.
 *
 * Called at config-write time rather than at authorize time, so a customer finds out they picked a
 * reserved name when they save the setting, not when a user's consent screen renders wrong.
 */
export function assertCustomScopeIdsAreValid(scopeIds: string[]): void {
  for (const scopeId of scopeIds) {
    const split = splitOnFirstColon(scopeId);
    if (split && (RESERVED_SCOPE_PREFIXES as readonly string[]).includes(split.prefix)) {
      throw new HexclaveAssertionError(
        `Custom scope ${JSON.stringify(scopeId)} uses the reserved prefix ${JSON.stringify(split.prefix)}. That prefix is generated automatically from your RBAC permissions.`,
        { scopeId },
      );
    }
    if ((OIDC_STANDARD_SCOPES as readonly string[]).includes(scopeId)) {
      throw new HexclaveAssertionError(
        `Custom scope ${JSON.stringify(scopeId)} is a standard OIDC scope and cannot be redefined.`,
        { scopeId },
      );
    }
    if (!isValidCustomScopeId(scopeId)) {
      throw new HexclaveAssertionError(
        `Custom scope ${JSON.stringify(scopeId)} is not a valid scope ID. Scope IDs are lowercase alphanumeric with underscores, colons, dots and dashes.`,
        { scopeId },
      );
    }
  }
}

import.meta.vitest?.describe("parseScope", (test) => {
  test("parses permission scopes", ({ expect }) => {
    expect(parseScope("perm:read_docs")).toEqual({ type: "project_permission", permissionId: "read_docs" });
    expect(parseScope("team_perm:read_docs")).toEqual({ type: "team_permission", permissionId: "read_docs" });
  });

  test("parses `$`-prefixed team system permissions", ({ expect }) => {
    expect(parseScope("team_perm:$delete_team")).toEqual({ type: "team_permission", permissionId: "$delete_team" });
  });

  test("splits on the FIRST colon only, so permission IDs may contain colons", ({ expect }) => {
    // `billing:read` is one permission ID, not a nested path.
    expect(parseScope("perm:billing:read")).toEqual({ type: "project_permission", permissionId: "billing:read" });
  });

  test("parses OIDC standard scopes", ({ expect }) => {
    for (const scope of OIDC_STANDARD_SCOPES) {
      expect(parseScope(scope)).toEqual({ type: "oidc", scope });
    }
  });

  test("parses custom scopes, including colon-namespaced ones", ({ expect }) => {
    expect(parseScope("files")).toEqual({ type: "custom", scopeId: "files" });
    expect(parseScope("files:read")).toEqual({ type: "custom", scopeId: "files:read" });
  });

  test("rejects malformed scopes", ({ expect }) => {
    for (const scope of ["", "perm:", "team_perm:", "perm:UPPER", "perm:has space", "has space", "perm:$"]) {
      expect(tryParseScope(scope), `expected ${JSON.stringify(scope)} to be rejected`).toBeNull();
    }
  });
});

import.meta.vitest?.describe("narrowPermissionsByScopes", (test) => {
  const perms = [
    { id: "read_docs", user_id: "u1" },
    { id: "write_docs", user_id: "u1" },
    { id: "billing:read", user_id: "u1" },
  ];

  test("null means full authority — the pre-scopes behaviour", ({ expect }) => {
    expect(narrowPermissionsByScopes(perms, null, "project")).toEqual(perms);
  });

  test("an empty scope list is NOT the same as null; it grants nothing", ({ expect }) => {
    expect(narrowPermissionsByScopes(perms, [], "project")).toEqual([]);
  });

  test("narrows to the intersection", ({ expect }) => {
    expect(narrowPermissionsByScopes(perms, ["perm:read_docs"], "project")).toEqual([
      { id: "read_docs", user_id: "u1" },
    ]);
  });

  test("a scope for a permission the user lacks grants nothing — consent cannot escalate", ({ expect }) => {
    expect(narrowPermissionsByScopes(perms, ["perm:delete_everything"], "project")).toEqual([]);
    // ...and it does not accidentally let the other, held permissions through either.
    expect(narrowPermissionsByScopes(perms, ["perm:delete_everything", "perm:read_docs"], "project")).toEqual([
      { id: "read_docs", user_id: "u1" },
    ]);
  });

  test("team and project scopes do not cross over", ({ expect }) => {
    // A `team_perm:` grant must not unlock a project permission of the same name.
    expect(narrowPermissionsByScopes(perms, ["team_perm:read_docs"], "project")).toEqual([]);
    expect(narrowPermissionsByScopes(perms, ["perm:read_docs"], "team")).toEqual([]);
  });

  test("permission IDs containing colons survive the round trip", ({ expect }) => {
    expect(narrowPermissionsByScopes(perms, [getProjectPermissionScope("billing:read")], "project")).toEqual([
      { id: "billing:read", user_id: "u1" },
    ]);
  });

  test("non-permission scopes contribute no authority", ({ expect }) => {
    expect(narrowPermissionsByScopes(perms, ["openid", "profile", "files:read"], "project")).toEqual([]);
  });

  test("an unparsable scope is ignored rather than throwing, and grants nothing", ({ expect }) => {
    // A token minted before a scope was renamed is a legitimate state; failing closed is correct.
    expect(narrowPermissionsByScopes(perms, ["perm:", "perm:read_docs"], "project")).toEqual([
      { id: "read_docs", user_id: "u1" },
    ]);
  });

  test("narrowing is idempotent and never grows the list", ({ expect }) => {
    const once = narrowPermissionsByScopes(perms, ["perm:read_docs", "perm:write_docs"], "project");
    const twice = narrowPermissionsByScopes(once, ["perm:read_docs", "perm:write_docs"], "project");
    expect(twice).toEqual(once);
    expect(once.length).toBeLessThanOrEqual(perms.length);
  });
});

import.meta.vitest?.describe("assertCustomScopeIdsAreValid", (test) => {
  test("rejects the reserved permission prefixes", ({ expect }) => {
    expect(() => assertCustomScopeIdsAreValid(["perm:anything"])).toThrow(/reserved prefix/);
    expect(() => assertCustomScopeIdsAreValid(["team_perm:anything"])).toThrow(/reserved prefix/);
  });

  test("rejects redefining an OIDC standard scope", ({ expect }) => {
    expect(() => assertCustomScopeIdsAreValid(["openid"])).toThrow(/standard OIDC scope/);
  });

  test("accepts ordinary custom scopes", ({ expect }) => {
    expect(() => assertCustomScopeIdsAreValid(["files", "files:read", "files.read", "files-read"])).not.toThrow();
  });

  test("rejects malformed scope IDs", ({ expect }) => {
    expect(() => assertCustomScopeIdsAreValid(["has space"])).toThrow();
    expect(() => assertCustomScopeIdsAreValid(["UPPER"])).toThrow();
  });

  // `permissions` is not a reserved prefix, so a scope that merely *starts* with the letters of one
  // must still be allowed — the check is on the prefix up to the first colon, not a string prefix.
  test("does not over-reject scopes that merely start with reserved letters", ({ expect }) => {
    expect(() => assertCustomScopeIdsAreValid(["permanent:read", "team_permissions_ui"])).not.toThrow();
  });
});
