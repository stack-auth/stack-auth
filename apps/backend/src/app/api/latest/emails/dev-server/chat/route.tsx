import { openai } from "@ai-sdk/openai";
import { yupArray, yupNumber, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { convertToCoreMessages, streamText } from "ai";
import { yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Chat with the dev server",
    description: "Chat with the dev server to get help with email theme development",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
    }),
    body: yupObject({
    messages: yupArray(yupObject({
      role: yupString().oneOf(["user", "assistant"]).defined(),
        content: yupString().defined(),
      })).defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["binary"]).defined(),
    body: yupArrayBuffer().defined(),
  }),
  async handler({ body }) {
    const result = streamText({
      model: openai("gpt-4o"),
      messages: convertToCoreMessages(body.messages),
    });

    return {
      statusCode: 200,
      bodyType: "binary",
      body: result.toDataStreamResponse().arrayBuffer(),
    };
  },
});
