import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: "Save a chat message",
    description: "Save a chat message",
    tags: ["AI Chat"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      threadId: yupString().defined(),
    }),
    body: yupObject({
      message: yupMixed().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  async handler({ body, params, auth: { tenancy } }) {
    await globalPrismaClient.threadMessage.create({
      data: {
        tenancyId: tenancy.id,
        threadId: params.threadId,
        content: body.message
      },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {},
    };
  },
});

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      threadId: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      messages: yupArray(yupMixed().defined()),
    }),
  }),
  async handler({ params, auth: { tenancy } }) {
    const dbMessages = await globalPrismaClient.threadMessage.findMany({
      where: { tenancyId: tenancy.id, threadId: params.threadId },
      orderBy: { createdAt: "asc" },
    });
    const messages = dbMessages.map((message) => message.content) as object[];

    return {
      statusCode: 200,
      bodyType: "json",
      body: { messages },
    };
  },
});
