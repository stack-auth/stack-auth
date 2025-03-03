import { prismaClient } from '@/prisma-client';
import { createSmartRouteHandler } from '@/route-handlers/smart-route-handler';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupNumber, yupObject, yupString } from '@stackframe/stack-shared/dist/schema-fields';

export const POST = createSmartRouteHandler({
  metadata: {
    summary: 'Poll CLI authentication status',
    description: 'Poll for the authentication status of a CLI login flow',
    tags: ['CLI Auth'],
  },
  request: yupObject({
    body: yupObject({
      polling_token: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(['json']).defined(),
    body: yupObject({
      status: yupString().oneOf(['pending', 'authorized', 'expired'] as const).defined(),
      refresh_token: yupString().optional(),
      access_token: yupString().optional(),
    }).defined(),
  }),
  async handler({ body: { polling_token } }): Promise<{
    statusCode: number,
    bodyType: 'json',
    body: {
      status: 'pending' | 'authorized' | 'expired',
      refresh_token?: string,
      access_token?: string,
    },
  }> {
    const cliAuthToken = await (prismaClient as any).cliAuthToken.findUnique({
      where: {
        pollingToken: polling_token,
      },
    });

    if (!cliAuthToken) {
      throw new KnownErrors.InvalidPollingToken();
    }

    if (cliAuthToken.expiresAt < new Date()) {
      return {
        statusCode: 200,
        bodyType: 'json',
        body: {
          status: 'expired',
        },
      };
    }

    if (!cliAuthToken.internalToken || !cliAuthToken.refreshToken) {
      return {
        statusCode: 200,
        bodyType: 'json',
        body: {
          status: 'pending',
        },
      };
    }

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        status: 'authorized',
        refresh_token: cliAuthToken.refreshToken,
        access_token: cliAuthToken.internalToken,
      },
    };
  },
});
