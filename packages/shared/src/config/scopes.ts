export const PROJECT_PERMISSION_SCOPE_PREFIX = "perm";
export const TEAM_PERMISSION_SCOPE_PREFIX = "team_perm";
export const OIDC_STANDARD_SCOPES = ["openid", "profile", "email", "offline_access", "address", "phone"] as const;
export const RESERVED_SCOPE_PREFIXES = [PROJECT_PERMISSION_SCOPE_PREFIX, TEAM_PERMISSION_SCOPE_PREFIX] as const;
export const customScopeIdRegex = /^[a-z0-9_:.-]+$/;
export const permissionIdRegex = /^\$?[a-z0-9_:]+$/;

export function splitScopeOnFirstColon(scope: string): { prefix: string, rest: string } | undefined {
  const index = scope.indexOf(":");
  return index === -1 ? undefined : { prefix: scope.slice(0, index), rest: scope.slice(index + 1) };
}

export function isValidCustomScopeId(scopeId: string): boolean {
  const split = splitScopeOnFirstColon(scopeId);
  return customScopeIdRegex.test(scopeId)
    && (split === undefined || !RESERVED_SCOPE_PREFIXES.some(prefix => prefix === split.prefix))
    && !(OIDC_STANDARD_SCOPES as readonly string[]).includes(scopeId);
}

export function getProjectPermissionScope(permissionId: string): string {
  return `${PROJECT_PERMISSION_SCOPE_PREFIX}:${permissionId}`;
}

export function getTeamPermissionScope(permissionId: string): string {
  return `${TEAM_PERMISSION_SCOPE_PREFIX}:${permissionId}`;
}

export function isValidPermissionId(permissionId: string): boolean {
  return permissionIdRegex.test(permissionId);
}

export function isValidPermissionScope(scope: string): boolean {
  const split = splitScopeOnFirstColon(scope);
  return split !== undefined
    && (RESERVED_SCOPE_PREFIXES as readonly string[]).includes(split.prefix)
    && isValidPermissionId(split.rest);
}

type PermissionLike = { id: string };

export function narrowPermissionsByScopes<P extends PermissionLike>(
  permissions: P[],
  grantedScopes: string[] | null,
  scope: "team" | "project",
): P[] {
  if (grantedScopes === null) return permissions;

  const wantedType = scope === "team" ? TEAM_PERMISSION_SCOPE_PREFIX : PROJECT_PERMISSION_SCOPE_PREFIX;
  const grantedPermissionIds = new Set<string>();
  for (const grantedScope of grantedScopes) {
    const split = splitScopeOnFirstColon(grantedScope);
    if (split?.prefix === wantedType && split.rest.length > 0 && isValidPermissionId(split.rest)) {
      grantedPermissionIds.add(split.rest);
    }
  }
  return permissions.filter(permission => grantedPermissionIds.has(permission.id));
}

import.meta.vitest?.describe("narrowPermissionsByScopes", (test) => {
  const permissions = [{ id: "read" }, { id: "write" }];

  test("keeps only permissions granted by the token", ({ expect }) => {
    expect(narrowPermissionsByScopes(permissions, ["perm:read"], "project")).toEqual([{ id: "read" }]);
    expect(narrowPermissionsByScopes(permissions, [], "project")).toEqual([]);
  });

  test("does not cross project and team permission namespaces", ({ expect }) => {
    expect(narrowPermissionsByScopes(permissions, ["team_perm:read"], "project")).toEqual([]);
    expect(narrowPermissionsByScopes(permissions, ["team_perm:read"], "team")).toEqual([{ id: "read" }]);
  });
});
