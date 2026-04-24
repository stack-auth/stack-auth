import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export function getConfigForInternalConfigResponse<T extends { emails: { server: { isShared?: boolean, senderEmail?: string | undefined } } }>(config: T): T {
  if (!config.emails.server.isShared) {
    return config;
  }

  return {
    ...config,
    emails: {
      ...config.emails,
      server: {
        ...config.emails.server,
        senderEmail: getEnvVariable("STACK_EMAIL_SENDER"),
      },
    },
  };
}

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: 'Get the config',
    description: 'Get the config for a project and branch',
    tags: ['Config'],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      config_string: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const config = getConfigForInternalConfigResponse(req.auth.tenancy.config);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        config_string: JSON.stringify(config),
      },
    };
  },
});
