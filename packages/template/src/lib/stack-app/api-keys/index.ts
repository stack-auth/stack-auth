import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateInputSchema, userApiKeysCreateInputSchema } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { IfAndOnlyIf, PrettifyType } from "@stackframe/stack-shared/dist/utils/types";
import type * as yup from "yup";

export type ApiKeyType = "user" | "team";

/**
 * Represents an API key for programmatic authentication.
 * Can be associated with either a user or a team.
 */
export type ApiKey<Type extends ApiKeyType = ApiKeyType, IsFirstView extends boolean = false> =
  & {
      /**
       * The unique identifier for this API key.
       */
      id: string,

      /**
       * A human-readable description of the API key's purpose.
       */
      description: string,

      /**
       * The date and time when this API key will expire. If not set, the key does not expire.
       */
      expiresAt?: Date,

      /**
       * The date when the key was manually revoked, or null if not revoked.
       */
      manuallyRevokedAt?: Date | null,

      /**
       * The date and time when this API key was created.
       */
      createdAt: Date,

      /**
       * The API key value. On first view (after creation), this is the full key string.
       * In subsequent views (from list methods), this is an object with only the last four characters.
       */
      value: IfAndOnlyIf<IsFirstView, true, string, { lastFour: string }>,

      /**
       * Updates the API key properties.
       */
      update(options: ApiKeyUpdateOptions<Type>): Promise<void>,

      /**
       * Revokes the API key, making it permanently invalid.
       */
      revoke: () => Promise<void>,

      /**
       * Returns whether the API key is currently valid (not expired and not revoked).
       */
      isValid: () => boolean,

      /**
       * Returns the reason why the key is invalid, or null if it's valid.
       */
      whyInvalid: () => "manually-revoked" | "expired" | null,
    }
  & (
    | ("user" extends Type ? { type: "user", userId: string } : never)
    | ("team" extends Type ? { type: "team", teamId: string } : never)
  );

/**
 * API key with full value visible (returned by createApiKey).
 */
export type UserApiKeyFirstView = PrettifyType<ApiKey<"user", true>>;

/**
 * User API key with masked value (returned by listApiKeys/useApiKeys).
 */
export type UserApiKey = PrettifyType<ApiKey<"user", false>>;

/**
 * Team API key with full value visible (returned by createApiKey).
 */
export type TeamApiKeyFirstView = PrettifyType<ApiKey<"team", true>>;

/**
 * Team API key with masked value (returned by listApiKeys/useApiKeys).
 */
export type TeamApiKey = PrettifyType<ApiKey<"team", false>>;

export type ApiKeyCreationOptions<Type extends ApiKeyType = ApiKeyType> =
  & {
    description: string,
    expiresAt: Date | null,
    /**
     * Whether the API key should be considered public. A public API key will not be detected by the secret scanner, which
     * automatically revokes API keys when it detects that they may have been exposed to the public.
     */
    isPublic?: boolean,
  };
export function apiKeyCreationOptionsToCrud(type: "user", userId: string, options: ApiKeyCreationOptions<"user">): Promise<yup.InferType<typeof userApiKeysCreateInputSchema>>;
export function apiKeyCreationOptionsToCrud(type: "team", teamId: string, options: ApiKeyCreationOptions<"team">): Promise<yup.InferType<typeof teamApiKeysCreateInputSchema>>;
export function apiKeyCreationOptionsToCrud(type: ApiKeyType, userIdOrTeamId: string, options: ApiKeyCreationOptions): Promise<yup.InferType<typeof userApiKeysCreateInputSchema> | yup.InferType<typeof teamApiKeysCreateInputSchema>>;
export async function apiKeyCreationOptionsToCrud(type: ApiKeyType, userIdOrTeamId: string, options: ApiKeyCreationOptions): Promise<yup.InferType<typeof userApiKeysCreateInputSchema> | yup.InferType<typeof teamApiKeysCreateInputSchema>> {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt == null ? options.expiresAt : options.expiresAt.getTime(),
    is_public: options.isPublic,
    ...(type === "user" ? { user_id: userIdOrTeamId } : { team_id: userIdOrTeamId }),
  };
}


export type ApiKeyUpdateOptions<Type extends ApiKeyType = ApiKeyType> = {
  description?: string,
  expiresAt?: Date | null,
  revoked?: boolean,
};
export function apiKeyUpdateOptionsToCrud(type: "user", options: ApiKeyUpdateOptions<"user">): Promise<UserApiKeysCrud["Client"]["Update"]>;
export function apiKeyUpdateOptionsToCrud(type: "team", options: ApiKeyUpdateOptions<"team">): Promise<TeamApiKeysCrud["Client"]["Update"]>;
export function apiKeyUpdateOptionsToCrud(type: ApiKeyType, options: ApiKeyUpdateOptions): Promise<UserApiKeysCrud["Client"]["Update"] | TeamApiKeysCrud["Client"]["Update"]>;
export async function apiKeyUpdateOptionsToCrud(type: ApiKeyType, options: ApiKeyUpdateOptions): Promise<UserApiKeysCrud["Client"]["Update"] | TeamApiKeysCrud["Client"]["Update"]> {
  return filterUndefined({
    description: options.description,
    expires_at_millis: options.expiresAt == null ? options.expiresAt : options.expiresAt.getTime(),
    revoked: options.revoked,
  });
}
