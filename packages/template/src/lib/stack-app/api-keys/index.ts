import { TeamApiKeysCrud, UserApiKeysCrud, teamApiKeysCreateInputSchema, userApiKeysCreateInputSchema } from "@stackframe/stack-shared/dist/interface/crud/project-api-keys";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { IfAndOnlyIf, PrettifyType } from "@stackframe/stack-shared/dist/utils/types";
import type * as yup from "yup";

export type ApiKeyType = "user" | "team";

export type ApiKey<Type extends ApiKeyType = ApiKeyType, IsFirstView extends boolean = false> =
  & {
      id: string,
      description: string,
      expiresAt?: Date,
      manuallyRevokedAt?: Date | null,
      createdAt: Date,
      value: IfAndOnlyIf<IsFirstView, true, string, { lastFour: string }>,
      update(options: ApiKeyUpdateOptions<Type>): Promise<void>,
      revoke: () => Promise<void>,
      isValid: () => boolean,
      whyInvalid: () => "manually-revoked" | "expired" | null,
    }
  & (
    | ("user" extends Type ? { type: "user", userId: string } : never)
    | ("team" extends Type ? { type: "team", teamId: string } : never)
  );

export type UserApiKeyFirstView = PrettifyType<ApiKey<"user", true>>;
export type UserApiKey = PrettifyType<ApiKey<"user", false>>;

export type TeamApiKeyFirstView = PrettifyType<ApiKey<"team", true>>;
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
