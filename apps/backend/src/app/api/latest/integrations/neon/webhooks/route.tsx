import { getSvixClient } from "@/lib/webhooks";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, neonAuthorizationHeaderSchema, urlSchema, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      project: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      url: urlSchema.defined(),
      description: yupString().optional(),
    }).defined(),
    headers: yupObject({
      authorization: yupTuple([neonAuthorizationHeaderSchema.defined()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      secret: yupString().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const svix = getSvixClient();
    await svix.application.getOrCreate({ uid: auth.project.id, name: auth.project.id });
    const endpoint = await svix.endpoint.create(auth.project.id, { url: body.url, description: body.description });
    const secret = await svix.endpoint.getSecret(auth.project.id, endpoint.id);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        secret: secret.key,
      },
    };
  },
});
