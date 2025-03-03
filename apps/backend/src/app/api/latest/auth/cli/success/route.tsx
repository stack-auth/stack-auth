import { prismaClient } from '@/prisma-client';
import { createSmartRouteHandler } from '@/route-handlers/smart-route-handler';
import { KnownErrors } from '@stackframe/stack-shared';
import { yupNumber, yupObject, yupString } from '@stackframe/stack-shared/dist/schema-fields';

export const GET = createSmartRouteHandler({
  metadata: {
    summary: 'CLI login success',
    description: 'Success page for CLI login flow',
    tags: ['CLI Auth'],
  },
  request: yupObject({
    query: yupObject({
      polling_token: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(['text']).defined(),
    body: yupString().defined(),
  }),
  async handler({ query: { polling_token } }) {
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

    if (!cliAuthToken.internalToken || !cliAuthToken.refreshToken) {
      throw new KnownErrors.CliTokenNotAuthorized();
    }

    return {
      statusCode: 200,
      bodyType: 'text',
      body: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>CLI Login Success</title>
            <style>
              body {
                font-family: sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                background-color: #f5f5f5;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              }
              h1 {
                margin-top: 0;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>CLI Login Successful</h1>
              <p>You have successfully authenticated the CLI. You can now close this window and return to the CLI.</p>
            </div>
          </body>
        </html>
      `,
    };
  },
});
