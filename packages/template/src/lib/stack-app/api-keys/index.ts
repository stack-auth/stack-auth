import { ApiKeyCreateCrudRequest } from "@stackframe/stack-shared/dist/interface/adminInterface";
import { ApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/api-keys";


export type ApiKeyBase = {
  id: string,
  description: string,
  expiresAt: Date,
  manuallyRevokedAt: Date | null,
  createdAt: Date,
  isValid(): boolean,
  whyInvalid(): "expired" | "manually-revoked" | null,
  revoke(): Promise<void>,
};

export type ApiKeyBaseCrudRead = Pick<ApiKeysCrud["Admin"]["Read"], "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis">;

export type ApiKeyFirstView = {
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
} & ApiKeyBase;

export type ApiKey = {
  publishableClientKey: null | {
    lastFour: string,
  },
  secretServerKey: null | {
    lastFour: string,
  },
  superSecretAdminKey: null | {
    lastFour: string,
  },
} & ApiKeyBase;

export type ApiKeyCreateOptions = {
  description: string,
  expiresAt: Date,
  hasPublishableClientKey: boolean,
  hasSecretServerKey: boolean,
  hasSuperSecretAdminKey: boolean,
};
export function apiKeyCreateOptionsToCrud(options: ApiKeyCreateOptions): ApiKeyCreateCrudRequest {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt.getTime(),
    has_publishable_client_key: options.hasPublishableClientKey,
    has_secret_server_key: options.hasSecretServerKey,
    has_super_secret_admin_key: options.hasSuperSecretAdminKey,
  };
}
