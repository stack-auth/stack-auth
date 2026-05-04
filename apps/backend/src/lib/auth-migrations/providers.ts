import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createBetterAuthStackPersistence } from "./better-auth-persistence";
import type { AuthMigrationCredentials, AuthMigrationProvider, BetterAuthMigrationCredentials, StackImportOptions, StackMigrationPlan } from "./types";

export type PreparedMigration = {
  plan: StackMigrationPlan,
  options: StackImportOptions,
};

function getProviderIdMap(credentials: AuthMigrationCredentials): Map<string, string> | undefined {
  const raw = credentials.provider_id_map;
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new StatusError(400, "provider_id_map must be an object from source provider IDs to Stack Auth provider IDs.");
  }
  return new Map(Object.entries(raw).map(([key, value]) => {
    if (typeof value !== "string") {
      throw new StatusError(400, `provider_id_map.${key} must be a string.`);
    }
    return [key, value];
  }));
}

function getImportOptions(credentials: AuthMigrationCredentials): StackImportOptions {
  const unsupportedPasswordHashAction = credentials.unsupported_password_hash_action;
  if (unsupportedPasswordHashAction != null && unsupportedPasswordHashAction !== "error" && unsupportedPasswordHashAction !== "omit") {
    throw new StatusError(400, "unsupported_password_hash_action must be either error or omit.");
  }
  return {
    providerIdMap: getProviderIdMap(credentials),
    unsupportedPasswordHashAction: unsupportedPasswordHashAction ?? "error",
  };
}

function isBetterAuthCreateRecord(value: unknown): value is NonNullable<BetterAuthMigrationCredentials["records"]>[number] {
  return typeof value === "object" && value !== null && "model" in value && typeof value.model === "string" && "data" in value && typeof value.data === "object" && value.data !== null && !Array.isArray(value.data);
}

function requireString(credentials: AuthMigrationCredentials, key: string, label: string): void {
  if (typeof credentials[key] !== "string" || credentials[key].trim() === "") {
    throw new StatusError(400, `${label} is required.`);
  }
}

export function validateAuthMigrationCredentials(provider: AuthMigrationProvider, credentials: AuthMigrationCredentials): void {
  getImportOptions(credentials);

  switch (provider) {
    case "workos": {
      requireString(credentials, "api_key", "WorkOS API key");
      return;
    }
    case "clerk": {
      requireString(credentials, "secret_key", "Clerk secret key");
      return;
    }
    case "authjs": {
      requireString(credentials, "database_url", "Auth.js database URL");
      return;
    }
    case "auth0": {
      requireString(credentials, "domain", "Auth0 domain");
      requireString(credentials, "client_id", "Auth0 Management API client ID");
      requireString(credentials, "client_secret", "Auth0 Management API client secret");
      return;
    }
    case "supabase": {
      requireString(credentials, "project_url", "Supabase project URL");
      requireString(credentials, "service_role_key", "Supabase service role key");
      return;
    }
    case "better_auth": {
      if (Array.isArray(credentials.records)) return;
      requireString(credentials, "database_url", "Better Auth database URL");
      return;
    }
  }
}

async function prepareBetterAuthMigration(credentials: BetterAuthMigrationCredentials): Promise<PreparedMigration> {
  const persistence = createBetterAuthStackPersistence();
  const records = credentials.records;
  if (!Array.isArray(records)) {
    throw new StatusError(501, "Better Auth database migrations are queued through this endpoint, but the Better Auth database runner is not implemented yet.");
  }
  for (const record of records) {
    if (!isBetterAuthCreateRecord(record)) {
      throw new StatusError(400, "Every Better Auth migration record must have string model and object data fields.");
    }
    await persistence.adapter.create(record);
  }
  const options = getImportOptions(credentials);
  return {
    plan: persistence.buildPlan(options),
    options,
  };
}

export async function prepareAuthMigration(provider: AuthMigrationProvider, credentials: AuthMigrationCredentials): Promise<PreparedMigration> {
  if (provider === "better_auth") {
    return await prepareBetterAuthMigration(credentials as BetterAuthMigrationCredentials);
  }

  throw new StatusError(501, `${provider} migrations are queued through this endpoint, but the provider runner is not implemented yet.`);
}
