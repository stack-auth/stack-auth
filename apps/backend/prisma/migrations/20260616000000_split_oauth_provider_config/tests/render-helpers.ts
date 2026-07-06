import { Config, NormalizedConfig, NormalizedConfigValue, normalize, override } from '@hexclave/shared/dist/config/format';
import { applyOrganizationDefaults } from '@hexclave/shared/dist/config/schema';

// Shared helpers to render a config the way the backend does (env overrides branch, then apply
// defaults + normalize), so the migration tests can check the final rendered result, not just
// the raw DB rows. Values are checked at runtime instead of blindly cast, so bad test data fails.

// Check a DB-read JSON value is an object and treat it as a Config.
export function asConfig(value: unknown): Config {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected a config object, got: ${JSON.stringify(value)}`);
  }
  return value as Config;
}

// Check a rendered value is an object (used to walk into nested config).
export function asObject(value: NormalizedConfigValue | undefined): NormalizedConfig {
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected a normalized object, got: ${JSON.stringify(value)}`);
  }
  return value;
}

// Walk a path of keys (asserting each step is an object) and return the final object.
export function getIn(config: NormalizedConfig, path: readonly string[]): NormalizedConfig {
  let current: NormalizedConfig = config;
  for (const key of path) {
    current = asObject(current[key]);
  }
  return current;
}

// Render the merged config (env over branch) the way the backend does.
export function renderConfig(branchConfig: unknown, envConfig: unknown): NormalizedConfig {
  const merged = override(asConfig(branchConfig ?? {}), asConfig(envConfig ?? {}));
  // The cast just matches applyOrganizationDefaults' input type; production renders the same way.
  return normalize(
    applyOrganizationDefaults(merged as Parameters<typeof applyOrganizationDefaults>[0]),
    { onDotIntoNonObject: 'ignore' },
  );
}

// The rendered OAuth provider list (`auth.oauth.providers`).
export function renderProviders(branchConfig: unknown, envConfig: unknown): NormalizedConfig {
  return getIn(renderConfig(branchConfig, envConfig), ['auth', 'oauth', 'providers']);
}
