import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { getProvider } from "@/oauth";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@hexclave/shared";
import { connectedAccountAccessTokenCrud } from "@hexclave/shared/dist/interface/crud/connected-accounts";
import { userIdOrMeSchema, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";
import { isSharedAccessTokenBlocked, retrieveOrRefreshAccessToken } from "../../../access-token-helpers";


export const connectedAccountAccessTokenCrudHandlers = createLazyProxy(() => createCrudHandlers(connectedAccountAccessTokenCrud, {
  paramsSchema: yupObject({
    provider_id: yupString().defined(),
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

    if (isSharedAccessTokenBlocked(provider.isShared)) {
      throw new KnownErrors.OAuthAccessTokenNotAvailableWithSharedOAuthKeys();
    }

    const user = await usersCrudHandlers.adminRead({ tenancy: auth.tenancy, user_id: params.user_id });
    if (!user.oauth_providers.map(x => x.id).includes(params.provider_id)) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    // The connected-accounts access-token flow only uses the OAuth provider's
    // refresh and access-token-validity methods; neither uses `redirect_uri`.
    // `getProvider` resolves the callback URL from the provider's own config, so
    // this flow doesn't need to supply one.
    const providerInstance = await getProvider(provider, provider.id);
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Legacy endpoint: search tokens across ALL accounts for this provider and user
    const oauthAccounts = await prisma.projectUserOAuthAccount.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: params.user_id,
        configOAuthProviderId: params.provider_id,
      },
      select: { id: true },
    });

    if (oauthAccounts.length === 0) {
      throw new KnownErrors.OAuthConnectionNotConnectedToUser();
    }

    return await retrieveOrRefreshAccessToken({
      prisma,
      providerInstance,
      providerId: params.provider_id,
      tenancyId: auth.tenancy.id,
      oauthAccountIds: oauthAccounts.map(a => a.id),
      scope: data.scope,
      errorContext: {
        tenancyId: auth.tenancy.id,
        providerId: params.provider_id,
        userId: params.user_id,
        scope: data.scope,
      },
    });
  },
}));
