import type { ExternalAuthSnapshot, ExternalUser, JsonObject, StackImportOptions, StackMigrationPlan, StackUserCreateBody } from "./types";

function isSupportedStackPasswordHash(hash: string): boolean {
  return /^\$2[ayb]\$.{56}$/.test(hash);
}

function getProviderId(providerId: string, providerIdMap: Map<string, string>): string {
  return providerIdMap.get(providerId) ?? providerId;
}

function buildServerMetadata(source: string, externalIdField: string, externalId: string, metadata: JsonObject): JsonObject {
  return {
    ...metadata,
    migration: {
      source,
      [externalIdField]: externalId,
    },
  };
}

function mapUserToStackBody(source: string, user: ExternalUser, options: Required<StackImportOptions>): StackMigrationPlan["users"][number] {
  const body: StackUserCreateBody = {
    server_metadata: buildServerMetadata(source, "user_id", user.externalId, user.metadata),
  };

  if (user.primaryEmail != null) {
    body.primary_email = user.primaryEmail;
    body.primary_email_verified = user.primaryEmailVerified;
    body.primary_email_auth_enabled = true;
  }
  if (user.displayName != null) {
    body.display_name = user.displayName;
  }
  if (user.profileImageUrl != null) {
    body.profile_image_url = user.profileImageUrl;
  }
  if (user.passwordHash != null) {
    if (isSupportedStackPasswordHash(user.passwordHash)) {
      body.password_hash = user.passwordHash;
    } else if (options.unsupportedPasswordHashAction === "error") {
      throw new Error(`External user ${user.externalId} has an unsupported password hash. Stack Auth currently accepts bcrypt hashes for password_hash imports.`);
    }
  }
  if (user.restricted != null) {
    body.restricted_by_admin = true;
    body.restricted_by_admin_reason = user.restricted.reason;
    body.restricted_by_admin_private_details = user.restricted.privateDetails;
  }

  const oauthProviders = user.oauthAccounts
    .sort((a, b) => `${a.providerId}:${a.accountId}`.localeCompare(`${b.providerId}:${b.accountId}`))
    .map((account) => ({
      id: getProviderId(account.providerId, options.providerIdMap),
      account_id: account.accountId,
      email: account.email,
    }));
  if (oauthProviders.length > 0) {
    body.oauth_providers = oauthProviders;
  }

  return {
    externalUserId: user.externalId,
    body,
  };
}

export function buildStackMigrationPlan(snapshot: ExternalAuthSnapshot, options: StackImportOptions = {}): StackMigrationPlan {
  const resolvedOptions: Required<StackImportOptions> = {
    providerIdMap: options.providerIdMap ?? new Map<string, string>(),
    unsupportedPasswordHashAction: options.unsupportedPasswordHashAction ?? "error",
  };

  const users = [...snapshot.users]
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .map((user) => mapUserToStackBody(snapshot.source, user, resolvedOptions));

  const teams = [...snapshot.organizations]
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .map((organization) => ({
      externalOrganizationId: organization.externalId,
      body: {
        display_name: organization.displayName,
        ...(organization.profileImageUrl != null ? { profile_image_url: organization.profileImageUrl } : {}),
        server_metadata: buildServerMetadata(snapshot.source, "organization_id", organization.externalId, organization.metadata),
      },
    }));

  const memberships = [...snapshot.memberships]
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .map((membership) => ({
      externalMembershipId: membership.externalId,
      externalUserId: membership.externalUserId,
      externalOrganizationId: membership.externalOrganizationId,
      role: membership.role,
      metadata: membership.metadata,
    }));

  return { users, teams, memberships };
}
