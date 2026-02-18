import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getProvider } from "@/oauth";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { connectedAccountAccessTokenCrud } from "@stackframe/stack-shared/dist/interface/crud/connected-accounts";
import { userIdOrMeSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { retrieveOrRefreshAccessToken } from "../../../../access-token-helpers";


export const connectedAccountAccessTokenByAccountCrudHandlers = createLazyProxy(() => createCrudHandlers(connectedAccountAccessTokenCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().defined(),
    provider_account_id: yupString().defined(),
    user_id: userIdOrMeSchema.defined(),
  }),
  async onCreate({ auth, data, params }) {
    if (auth.type === 'client' && auth.user?.id !== params.user_id) {
      throw new StatusError(StatusError.Forbidden, "Client can only access its own connected accounts");
    }

    const providerRaw = Object.entries(auth.tenancy.config.auth.oauth.providers).find(([providerId, _]) => providerId === params.provider_id);
    if (!providerRaw) {
      throw new KnownErrors.OAuthProviderNotFoundOrNotEnabled();
    }

    const provider = { id: providerRaw[0], ...providerRaw[1] };

    if (provider.isShared && !getNodeEnvironment().includes('prod') && getEnvVariable('STACK_ALLOW_SHARED_OAUTH_ACCESS_TOKENS', '') !== 'true') {
      throw new KnownErrors.OAuthAccessTokenNotAvailableWithSharedOAuthKeys();
    }

    const user = await usersCrudHandlers.adminRead({ tenancy: auth.tenancy, user_id: params.user_id });

    const matchingProvider = user.oauth_providers.find(
      p => p.id === params.provider_id && p.account_id === params.provider_account_id
    );
    if (!matchingProvider) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    const providerInstance = await getProvider(provider);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const oauthAccount = await prisma.projectUserOAuthAccount.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: params.user_id,
        configOAuthProviderId: params.provider_id,
        providerAccountId: params.provider_account_id,
        allowConnectedAccounts: true,
      },
    });

    if (!oauthAccount) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    return await retrieveOrRefreshAccessToken({
      prisma,
      providerInstance,
      tenancyId: auth.tenancy.id,
      oauthAccountIds: [oauthAccount.id],
      scope: data.scope,
      errorContext: {
        tenancyId: auth.tenancy.id,
        providerId: params.provider_id,
        providerAccountId: params.provider_account_id,
        userId: params.user_id,
        scope: data.scope,
      },
    });
  },
}));
