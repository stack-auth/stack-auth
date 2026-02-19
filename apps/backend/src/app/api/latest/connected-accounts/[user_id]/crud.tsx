import { ensureUserExists } from "@/lib/request-checks";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { connectedAccountCrud } from "@stackframe/stack-shared/dist/interface/crud/connected-accounts";
import { userIdOrMeSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const connectedAccountCrudHandlers = createLazyProxy(() => createCrudHandlers(connectedAccountCrud, {
  paramsSchema: yupObject({
    user_id: userIdOrMeSchema.defined(),
  }),
  async onList({ auth, params }) {
    const userId = params.user_id;

    if (auth.type === 'client') {
      const currentUserId = auth.user?.id ?? throwErr(new KnownErrors.CannotGetOwnUserWithoutUser());
      if (!userId || currentUserId !== userId) {
        throw new StatusError(StatusError.Forbidden, 'Client can only list connected accounts for their own user.');
      }
    }

    const prismaClient = await getPrismaClientForTenancy(auth.tenancy);

    if (userId) {
      await ensureUserExists(prismaClient, { tenancyId: auth.tenancy.id, userId });
    }

    const oauthAccounts = await prismaClient.projectUserOAuthAccount.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: userId,
        allowConnectedAccounts: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      items: oauthAccounts.map((oauthAccount) => ({
        user_id: oauthAccount.projectUserId ?? throwErr("OAuth account has no project user ID"),
        provider: oauthAccount.configOAuthProviderId,
        provider_account_id: oauthAccount.providerAccountId,
      })),
      is_paginated: false,
    };
  },
}));
