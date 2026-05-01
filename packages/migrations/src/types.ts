export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

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

export type ExternalOAuthAccount = {
  providerId: string,
  accountId: string,
  email: string | null,
};

export type ExternalRestriction = {
  reason: string,
  privateDetails: string | null,
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

export type StackImportOptions = {
  providerIdMap?: Map<string, string>,
  unsupportedPasswordHashAction?: "error" | "omit",
};
