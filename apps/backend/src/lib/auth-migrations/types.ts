import type { Prisma } from "@/generated/prisma/client";

export const authMigrationProviders = ["workos", "clerk", "authjs", "auth0", "supabase", "better_auth"] as const;
export type AuthMigrationProvider = typeof authMigrationProviders[number];

export const authMigrationStatuses = ["PENDING", "RUNNING", "WAITING_RETRY", "SUCCEEDED", "FAILED"] as const;
export type AuthMigrationStatus = typeof authMigrationStatuses[number];

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

export type BetterAuthPersistenceRecord = JsonObject & {
  id: string,
};

export type BetterAuthWhere = {
  field: string,
  value: JsonValue,
  operator?: "eq" | "ne" | "in" | "contains" | "starts_with" | "ends_with",
}[];

export type BetterAuthCreateInput = {
  model: string,
  data: JsonObject,
};

export type BetterAuthFindOneInput = {
  model: string,
  where?: BetterAuthWhere,
};

export type BetterAuthFindManyInput = BetterAuthFindOneInput & {
  limit?: number,
  offset?: number,
};

export type BetterAuthUpdateInput = BetterAuthFindOneInput & {
  update: JsonObject,
};

export type BetterAuthPersistenceAdapter = {
  create(input: BetterAuthCreateInput): Promise<BetterAuthPersistenceRecord>,
  findOne(input: BetterAuthFindOneInput): Promise<BetterAuthPersistenceRecord | null>,
  findMany(input: BetterAuthFindManyInput): Promise<BetterAuthPersistenceRecord[]>,
  update(input: BetterAuthUpdateInput): Promise<BetterAuthPersistenceRecord | null>,
  updateMany(input: BetterAuthUpdateInput): Promise<number>,
  delete(input: BetterAuthFindOneInput): Promise<void>,
  deleteMany(input: BetterAuthFindOneInput): Promise<number>,
  count(input: BetterAuthFindOneInput): Promise<number>,
};

export type ExternalOAuthAccount = {
  providerId: string,
  accountId: string,
  email: string | null,
};

export type ExternalRestriction = {
  reason: string,
  privateDetails: string | null,
};

export type ExternalUser = {
  externalId: string,
  primaryEmail: string | null,
  primaryEmailVerified: boolean,
  displayName: string | null,
  profileImageUrl: string | null,
  passwordHash: string | null,
  oauthAccounts: ExternalOAuthAccount[],
  restricted: ExternalRestriction | null,
  metadata: JsonObject,
};

export type ExternalOrganization = {
  externalId: string,
  displayName: string,
  profileImageUrl: string | null,
  metadata: JsonObject,
};

export type ExternalMembership = {
  externalId: string,
  externalUserId: string,
  externalOrganizationId: string,
  role: string | null,
  metadata: JsonObject,
};

export type ExternalAuthSnapshot = {
  source: string,
  users: ExternalUser[],
  organizations: ExternalOrganization[],
  memberships: ExternalMembership[],
};

export type StackImportOptions = {
  providerIdMap?: Map<string, string>,
  unsupportedPasswordHashAction?: "error" | "omit",
};

export type StackUserCreateBody = {
  primary_email?: string,
  primary_email_verified?: boolean,
  primary_email_auth_enabled?: boolean,
  display_name?: string | null,
  profile_image_url?: string | null,
  password_hash?: string,
  oauth_providers?: {
    id: string,
    account_id: string,
    email: string | null,
  }[],
  restricted_by_admin?: boolean,
  restricted_by_admin_reason?: string | null,
  restricted_by_admin_private_details?: string | null,
  server_metadata: JsonObject,
};

export type StackTeamCreateBody = {
  display_name: string,
  profile_image_url?: string | null,
  server_metadata: JsonObject,
};

export type StackMigrationPlan = {
  users: {
    externalUserId: string,
    body: StackUserCreateBody,
  }[],
  teams: {
    externalOrganizationId: string,
    body: StackTeamCreateBody,
  }[],
  memberships: {
    externalMembershipId: string,
    externalUserId: string,
    externalOrganizationId: string,
    role: string | null,
    metadata: JsonObject,
  }[],
};

export type EncryptedMigrationCredentials = {
  ciphertext_base64: string,
};

export type BetterAuthMigrationCredentials = {
  records?: BetterAuthCreateInput[],
  database_url?: string,
};

export type AuthMigrationCredentials = JsonObject;

export type AuthMigrationJobRow = {
  id: string,
  tenancy_id: string,
  project_id: string,
  branch_id: string,
  provider: AuthMigrationProvider,
  status: AuthMigrationStatus,
  created_by_project_user_id: string | null,
  attempt_count: number,
  max_attempts: number,
  next_attempt_at: Date | null,
  started_at: Date | null,
  finished_at: Date | null,
  last_error_external_message: string | null,
  last_error_internal_details: Prisma.JsonValue | null,
  result: Prisma.JsonValue | null,
  created_at: Date,
  updated_at: Date,
};
