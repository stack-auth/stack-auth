/**
 * Central registry of all API scopes.
 *
 * Scopes are a coarse, OAuth-style axis of access control that gate *which slice of the API
 * surface a token is allowed to touch*. They are orthogonal to:
 *   - the access type (`client` / `server` / `admin`), which says *who* is calling, and
 *   - the permission system (`ensureUserTeamPermissionExists`, ...), which says *what a user
 *     may do to a specific resource*.
 *
 * A token can be a valid client token for a user who has the right permissions, yet still be
 * downscoped so it can only call a subset of endpoints. Server/admin secret keys are
 * full-trust and bypass scope checks entirely.
 *
 * This object is the single source of truth: endpoint declarations and token contents are
 * type-checked against it, so you cannot reference a scope that does not exist here.
 */
export const SCOPES = {
  "users:read": { description: "Read user profiles" },
  "users:write": { description: "Create, update, or delete users" },
  "teams:read": { description: "Read teams" },
  "teams:write": { description: "Create, update, or delete teams" },
  "team_memberships:read": { description: "Read team memberships" },
  "team_memberships:write": { description: "Add or remove team members" },
  "sessions:read": { description: "Read sessions" },
  "sessions:write": { description: "Create or revoke sessions" },
  "contact_channels:read": { description: "Read contact channels (emails, phone numbers)" },
  "contact_channels:write": { description: "Create, update, or delete contact channels" },
  "permissions:read": { description: "Read permissions and permission definitions" },
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export function isScope(value: string): value is Scope {
  return Object.prototype.hasOwnProperty.call(SCOPES, value);
}

/**
 * Parses a space-separated scope string (the OAuth `scope` convention, as stored in the JWT
 * `scope` claim and the refresh-token row) into a deduplicated list of scope strings.
 *
 * Unknown scope strings are intentionally preserved rather than dropped: a token may have been
 * minted before a scope was removed from the registry, and silently dropping it could widen
 * (never narrow) what the token can do. Enforcement only ever checks subset membership, so an
 * unknown scope simply never satisfies any current `requiredScopes` entry.
 */
export function parseScopeString(scopeString: string | null | undefined): string[] {
  if (scopeString == null) return [];
  return [...new Set(scopeString.split(" ").filter((s) => s.length > 0))];
}

export function scopesToString(scopes: readonly string[]): string {
  return [...new Set(scopes)].join(" ");
}

/**
 * Returns the subset of `requestedScopes` that are also present in `allowedScopes`. Used when
 * minting a downscoped token: a caller can never be granted a scope beyond what the underlying
 * session/grant already allows.
 */
export function intersectScopes(requestedScopes: readonly string[], allowedScopes: readonly string[]): string[] {
  const allowedSet = new Set(allowedScopes);
  return [...new Set(requestedScopes)].filter((s) => allowedSet.has(s));
}

/**
 * Returns the scopes in `requiredScopes` that are missing from `tokenScopes`. An empty result
 * means the token satisfies all required scopes.
 */
export function getMissingScopes(requiredScopes: readonly string[], tokenScopes: readonly string[]): string[] {
  const tokenSet = new Set(tokenScopes);
  return [...new Set(requiredScopes)].filter((s) => !tokenSet.has(s));
}
