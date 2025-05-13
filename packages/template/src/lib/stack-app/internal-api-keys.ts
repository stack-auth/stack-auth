import { InternalApiKeyCreateCrudRequest } from "@stackframe/stack-shared/dist/interface/adminInterface";
import { InternalApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/internal-api-keys";

export type InternalApiKeyBase = {
  id: string,
  description: string,
  expiresAt: Date,
  manuallyRevokedAt: Date | null,
  createdAt: Date,
  isValid(): boolean,
  whyInvalid(): "expired" | "manually-revoked" | null,
  revoke(): Promise<void>,
};

export type InternalApiKeyBaseCrudRead = Pick<InternalApiKeysCrud["Admin"]["Read"], "id" | "created_at_millis" | "description" | "expires_at_millis" | "manually_revoked_at_millis">;

export type InternalApiKeyFirstView = {
  publishableClientKey?: string,
  secretServerKey?: string,
  superSecretAdminKey?: string,
} & InternalApiKeyBase;

export type InternalApiKey = {
  publishableClientKey: null | {
    lastFour: string,
  },
  secretServerKey: null | {
    lastFour: string,
  },
  superSecretAdminKey: null | {
    lastFour: string,
  },
} & InternalApiKeyBase;

export type InternalApiKeyCreateOptions = {
  description: string,
  expiresAt: Date,
  hasPublishableClientKey: boolean,
  hasSecretServerKey: boolean,
  hasSuperSecretAdminKey: boolean,
};
export function internalApiKeyCreateOptionsToCrud(options: InternalApiKeyCreateOptions): InternalApiKeyCreateCrudRequest {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt.getTime(),
    has_publishable_client_key: options.hasPublishableClientKey,
    has_secret_server_key: options.hasSecretServerKey,
    has_super_secret_admin_key: options.hasSuperSecretAdminKey,
  };
}
