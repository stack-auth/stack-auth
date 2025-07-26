import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { clientProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { isTruthy } from "@stackframe/stack-shared/dist/utils/booleans";
import { filterUndefined, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

export const clientProjectsCrudHandlers = createLazyProxy(() => createCrudHandlers(clientProjectsCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    const config = auth.tenancy.config;
    const oauthProviders = typedEntries(config.auth.oauth.providers)
      .map(([oauthProviderId, oauthProvider]) => {
        if (!oauthProvider.type) {
          return undefined;
        }
        if (!oauthProvider.allowSignIn) {
          return undefined;
        }
        return filterUndefined({
          provider_config_id: oauthProviderId,
          id: oauthProvider.type,
          type: oauthProvider.isShared ? 'shared' : 'standard',
          client_id: oauthProvider.clientId,
          client_secret: oauthProvider.clientSecret,
          facebook_config_id: oauthProvider.facebookConfigId,
          microsoft_tenant_id: oauthProvider.microsoftTenantId,
        } as const);
      })
      .filter(isTruthy)
      .sort((a, b) => stringCompare(a.id, b.id));

    return {
      ...auth.project,
      config: {
        sign_up_enabled: config.auth.allowSignUp,
        credential_enabled: config.auth.password.allowSignIn,
        magic_link_enabled: config.auth.otp.allowSignIn,
        passkey_enabled: config.auth.passkey.allowSignIn,
        client_team_creation_enabled: config.teams.allowClientTeamCreation,
        client_user_deletion_enabled: config.users.allowClientUserDeletion,
        allow_user_api_keys: config.apiKeys.enabled.user,
        allow_team_api_keys: config.apiKeys.enabled.team,
        enabled_oauth_providers: oauthProviders,
      }
    };
  },
}));
