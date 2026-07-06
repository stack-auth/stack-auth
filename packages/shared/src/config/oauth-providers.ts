/**
 * OAuth provider config spans two layers, and this constant names the fields the BRANCH
 * layer owns — the single source of truth for the branch/environment partition:
 *
 *   - BRANCH owns the provider ROSTER and its enabled state: `type` (whose presence is
 *     what makes a provider render at all — see the render filter in `schema.ts`),
 *     `allowSignIn`, and `allowConnectedAccounts`. Writable even in development
 *     environments, so providers can be enabled/disabled there.
 *   - ENVIRONMENT owns everything else — each provider's credentials (`isShared`,
 *     `clientId`, `clientSecret`, `customCallbackUrl`, `issuerUrl`, …). Read-only in
 *     development environments.
 *
 * There is no separate "split" step: callers write the enable fields to the branch
 * config and the credentials to the environment config as ordinary objects, and the two
 * schemas (`branchConfigSchema` / `environmentConfigSchema`) define which fields are
 * valid where. `migrateConfigOverride("environment", …)` normalizes a whole provider
 * object into credential leaf keys and drops any branch field (using this constant), so
 * the environment layer can never clobber the branch-owned roster at render.
 *
 * NOTE: the DB migration that backfills this split
 * (`prisma/migrations/.../*_split_oauth_provider_config`) encodes the same field
 * partition in SQL. Keep the two in sync.
 */
export const OAUTH_PROVIDER_BRANCH_ENABLE_FIELDS = ["type", "allowSignIn", "allowConnectedAccounts"] as const;
