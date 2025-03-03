import { authorizeCliToken } from '@/app/api/latest/auth/cli/cli-helpers';
import { checkApiKeySet } from '@/lib/api-keys';
import { getSoleTenancyFromProject } from '@/lib/tenancies';
import { decodeAccessToken } from '@/lib/tokens';
import { prismaClient } from '@/prisma-client';
import { createSmartRouteHandler } from '@/route-handlers/smart-route-handler';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupNumber, yupObject, yupString } from '@stackframe/stack-shared/dist/schema-fields';
import { StatusError } from '@stackframe/stack-shared/dist/utils/errors';
import { redirect } from 'next/navigation';

export const GET = createSmartRouteHandler({
  metadata: {
    summary: 'Authorize CLI login',
    description: 'Authorize a CLI login flow from a browser',
    tags: ['CLI Auth'],
  },
  request: yupObject({
    query: yupObject({
      polling_token: yupString().defined(),
      client_id: yupString().defined(),
      token: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([302]).defined(),
    bodyType: yupString().oneOf(['empty']).defined(),
  }),
  async handler({ query: { polling_token, client_id, token } }) {
    const cliAuthToken = await (prismaClient as any).cliAuthToken.findUnique({
      where: {
        pollingToken: polling_token,
      },
    });

    if (!cliAuthToken) {
      throw new KnownErrors.InvalidPollingToken();
    }

    if (cliAuthToken.expiresAt < new Date()) {
      throw new KnownErrors.PollingTokenExpired();
    }

    const tenancy = await getSoleTenancyFromProject(client_id, true);

    if (!tenancy) {
      throw new KnownErrors.InvalidOAuthClientIdOrSecret(client_id);
    }

    if (!(await checkApiKeySet(client_id, { publishableClientKey: client_id }))) {
      throw new KnownErrors.InvalidPublishableClientKey(client_id);
    }

    // If the user is already authenticated, authorize the CLI token
    if (token) {
      const result = await decodeAccessToken(token);
      if (result.status === 'error') {
        throw result.error;
      }

      const { userId, projectId: accessTokenProjectId, branchId: accessTokenBranchId } = result.data;

      if (accessTokenProjectId !== client_id) {
        throw new StatusError(StatusError.Forbidden, 'The access token is not valid for this project');
      }

      if (accessTokenBranchId !== tenancy.branchId) {
        throw new StatusError(StatusError.Forbidden, 'The access token is not valid for this branch');
      }

      await authorizeCliToken({
        pollingToken: polling_token,
        tenancy,
        projectUserId: userId,
      });

      // Redirect to a success page
      return redirect(`/api/latest/auth/cli/success?polling_token=${polling_token}`);
    }

    // If the user is not authenticated, redirect to the login page
    return redirect(`/login?redirect_uri=/api/latest/auth/cli/callback?polling_token=${polling_token}&client_id=${client_id}`);
  },
});
