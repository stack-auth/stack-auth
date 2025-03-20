import { PublicApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/public-api-keys";

export type ApiKeyBase = {
  id: string,
  description?: string,
  expiresAt?: Date,
  manuallyRevokedAt?: Date | null,
  createdAt: Date,
  teamId?: string,
  tenancyId?: string,
  projectUserId?: string,
  isValid(): boolean,
  whyInvalid(): "expired" | "manually-revoked" | null,
  revoke(): Promise<void>,
};

// Define a more complete type that includes the secret_api_key field from the obfuscated read schema
export type ApiKeyBaseCrudRead = Pick<PublicApiKeysCrud["Client"]["Read"],
  "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis" |
  "team_id" | "tenancy_id" | "project_user_id"> & {
    secret_api_key?: {
      last_four: string,
    },
  };

// First view after creation, contains the actual secret
export type ApiKeyFirstView = {
  secretApiKey?: string,
} & ApiKeyBase;

// Subsequent views, contain only last four of secret
export type ApiKey = {
  secretApiKey: null | {
    lastFour: string,
  },
} & ApiKeyBase;

// Type alias for ApiKeyFirstView to maintain backward compatibility
export type ApiKeyWithSecret = ApiKeyFirstView;

export type ApiKeyCreateOptions = {
  description?: string,
  expiresAt?: Date,
  teamId?: string,
  tenancyId?: string,
  projectUserId?: string,
};

export type ApiKeyUpdateOptions = {
  description?: string,
  revoked?: boolean,
};

export function apiKeyCreateOptionsToCrud(options: ApiKeyCreateOptions): PublicApiKeysCrud["Client"]["Create"] {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt?.getTime(),
    team_id: options.teamId,
    tenancy_id: options.tenancyId,
    project_user_id: options.projectUserId,
  };
}

// Define the correct type for the create output
export type ApiKeyCreateOutput = Pick<PublicApiKeysCrud["Client"]["Read"],
  "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis" |
  "team_id" | "tenancy_id" | "project_user_id"> & {
    secret_api_key?: string,
  };


