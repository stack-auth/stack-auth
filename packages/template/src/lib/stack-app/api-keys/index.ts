import { TeamApiKeysCrud, UserApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";

// Base type for common API key functionality
export type BaseApiKey = {
  id: string,
  description?: string,
  expiresAt?: Date,
  manuallyRevokedAt?: Date | null,
  createdAt: Date,
  isValid(): boolean,
  whyInvalid(): "expired" | "manually-revoked" | null,
  revoke(): Promise<void>,
  // TODO BAZUMO implement update
};

// Define a more complete type that includes the secret_api_key field from the obfuscated read schema
export type BaseApiKeyCrudRead = Pick<UserApiKeysCrud["Client"]["Read"],
  "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis"> & {
    secret_api_key?: {
      last_four: string,
    },
  };


export type UserApiKeyCrudRead = BaseApiKeyCrudRead & {
  user_id: string,
};

export type TeamApiKeyCrudRead = BaseApiKeyCrudRead & {
  team_id: string,
};


// First view after creation, contains the actual secret
export type BaseApiKeyFirstView = {
  secretApiKey?: string,
} & BaseApiKey;

// Subsequent views, contain only last four of secret
export type BaseApiKeyView = {
  secretApiKey: null | {
    lastFour: string,
  },
} & BaseApiKey;

// Type alias for BaseApiKeyFirstView to maintain backward compatibility
export type BaseApiKeyWithSecret = BaseApiKeyFirstView;

export type BaseApiKeyCreateOptions = {
  description?: string,
  expiresAt?: Date,
};

export type BaseApiKeyUpdateOptions = {
  description?: string,
  revoked?: boolean,
};

// User API Key specific types
export type UserApiKey = BaseApiKey & {
  userId: string,
};


export type UserApiKeyFirstView = BaseApiKeyFirstView & {
  userId: string,
};

export type UserApiKeyView = BaseApiKeyView & {
  userId: string,
};

export type UserApiKeyWithSecret = UserApiKeyFirstView;

export type UserApiKeyCreateOptions = BaseApiKeyCreateOptions;

// Team API Key specific types
export type TeamApiKey = BaseApiKey & {
  teamId: string,
};

export type TeamApiKeyFirstView = BaseApiKeyFirstView & {
  teamId: string,
};

export type TeamApiKeyView = BaseApiKeyView & {
  teamId: string,
};

export type TeamApiKeyWithSecret = TeamApiKeyFirstView;

export type TeamApiKeyCreateOptions = BaseApiKeyCreateOptions;

// Helper functions to convert options to CRUD format
export function userApiKeyCreateOptionsToCrud(options: UserApiKeyCreateOptions, userId: string): UserApiKeysCrud["Client"]["Create"] {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt?.getTime(),
    user_id: userId,
  };
}

export function teamApiKeyCreateOptionsToCrud(options: TeamApiKeyCreateOptions, teamId: string): TeamApiKeysCrud["Client"]["Create"] {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt?.getTime(),
    team_id: teamId,
  };
}

// Define the correct type for the create output
export type UserApiKeyCreateOutput = Pick<UserApiKeysCrud["Client"]["Read"],
  "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis" |
  "user_id"> & {
    secret_api_key?: string,
  };

export type TeamApiKeyCreateOutput = Pick<TeamApiKeysCrud["Client"]["Read"],
  "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis" |
  "team_id"> & {
    secret_api_key?: string,
  };


