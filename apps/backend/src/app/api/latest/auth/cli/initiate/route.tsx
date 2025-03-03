import { createCliAuthToken } from '@/app/api/latest/auth/cli/cli-helpers';
import { createSmartRouteHandler } from '@/route-handlers/smart-route-handler';
import { yupNumber, yupObject, yupString } from '@stackframe/stack-shared/dist/schema-fields';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';

export const POST = createSmartRouteHandler({
  metadata: {
    summary: 'Initiate CLI login flow',
    description: 'Initiate the CLI login flow and generate a polling token',
    tags: ['CLI Auth'],
  },
  request: yupObject({
    body: yupObject({
      client_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(['json']).defined(),
    body: yupObject({
      polling_token: yupString().defined(),
      auth_url: yupString().defined(),
      expires_in_seconds: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ body: { client_id } }) {
    const cliAuthToken = await createCliAuthToken() as any;

    const apiUrl = getEnvVariable('NEXT_PUBLIC_STACK_API_URL');
    const authUrl = `${apiUrl}/api/latest/auth/cli/authorize?polling_token=${cliAuthToken.pollingToken}&client_id=${client_id}`;

    const expiresInSeconds = Math.floor((cliAuthToken.expiresAt.getTime() - Date.now()) / 1000);

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        polling_token: cliAuthToken.pollingToken,
        auth_url: authUrl,
        expires_in_seconds: expiresInSeconds,
      },
    };
  },
});
