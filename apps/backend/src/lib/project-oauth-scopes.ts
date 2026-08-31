/**
 * The entire scope vocabulary of a project's provider: the standard OIDC scopes, nothing else.
 *
 * `openid` and `offline_access` are protocol machinery; `profile` and `email` are backed by the
 * claim mapping in `findProjectOAuthAccount`. The other OIDC standard scopes (`address`, `phone`)
 * are deliberately absent because no claim mapping exists for them, so advertising them in the
 * discovery document would be a lie.
 */
export const PROJECT_OAUTH_OIDC_SCOPES = ["openid", "profile", "email", "offline_access"];
